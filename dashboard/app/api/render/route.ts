/**
 * POST /api/render
 *
 * Forwards a render request to the InDesign bridge:
 *   client -> Next.js API route -> bridge (127.0.0.1:3000) -> plugin -> InDesign DOM
 *
 * Per-render isolation strategy: in-memory `OpenOptions.openCopy`.
 *
 *   The bridge code (see dashboard/lib/render-script.mjs) calls
 *     await app.open(TEMPLATE_PATH, true, OpenOptions.openCopy)
 *   which loads the file content into a fresh untitled document
 *   without binding it to the original disk path. The original
 *   template file is never opened, never locked, never mutated.
 *   On close, the untitled doc is discarded and InDesign's
 *   Document.close() actually decrements app.documents.length
 *   (unlike close on a doc opened from a real path, which is a
 *   no-op in this UXP / InDesign 2026 build — see render-script.mjs
 *   header for full notes).
 *
 *   Net result: original immutable, per-render isolation, no on-disk
 *   working copies, no orphan files, no file lock to release.
 *
 * Output: streams the rendered PDF back as application/pdf so the
 * browser can preview it inline. The intermediate PDF file on disk
 * is also cleaned up after the bytes are read.
 *
 * Path safety: the bridge's POST /execute forwards code strings to the
 * plugin verbatim and does not run the Stage 1.5 path validator
 * (which lives in src/handlers/, the MCP-server codebase we are not
 * going through). We resolve to absolute and pre-check existence
 * locally; the only true boundary is InDesign's process-level file
 * permissions.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
    type Comp,
    formatSfAc,
    validateRenderRequest,
} from "@/lib/format";
// @ts-expect-error — plain ESM .mjs, no .d.ts; import shape is stable
import { buildBridgeCode } from "@/lib/render-script.mjs";

const BRIDGE_URL = "http://127.0.0.1:3000";

// The dashboard runs from `dashboard/`. Templates, mock-data, and the output
// dir are at the repo root, one level up. Allow override via env var.
const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const TEMPLATE_PATH = path.join(REPO_ROOT, "templates", "template-v2-test.indd");
const IMAGES_DIR = path.join(REPO_ROOT, "mock-data", "images");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");

type Json = Record<string, unknown>;

interface BridgeResult {
    ok: boolean;
    error?: string;
    populateMs?: number;
    exportMs?: number;
    totalMs?: number;
    tileTimes?: Array<{ n: number; ms: number }>;
    closeWarning?: string;
}

async function bridgeStatus(): Promise<{ connected: boolean; queueDepth: number }> {
    const r = await fetch(`${BRIDGE_URL}/status`, { cache: "no-store" });
    if (!r.ok) throw new Error(`bridge /status returned ${r.status}`);
    return (await r.json()) as { connected: boolean; queueDepth: number };
}

async function bridgeExecute(code: string): Promise<unknown> {
    const r = await fetch(`${BRIDGE_URL}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        cache: "no-store",
    });
    const body = (await r.json()) as Json;
    if (!r.ok) {
        const msg = (body.error as string | undefined) ?? `bridge ${r.status}`;
        const err = new Error(msg) as Error & { httpStatus?: number };
        err.httpStatus = r.status;
        throw err;
    }
    return body.result;
}

async function checkImagesExist(comps: Comp[]): Promise<{ ok: true } | { ok: false; missing: string[] }> {
    const missing: string[] = [];
    for (const c of comps) {
        const p = path.join(IMAGES_DIR, c.image_filename);
        try {
            const stat = await fs.stat(p);
            if (stat.size < 10 * 1024) {
                missing.push(`${c.image_filename} (only ${stat.size} bytes)`);
            }
        } catch {
            missing.push(c.image_filename);
        }
    }
    return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

async function bestEffortUnlink(p: string): Promise<void> {
    try {
        await fs.unlink(p);
    } catch {
        /* swallow — output/ is gitignored and these are tiny */
    }
}

export async function POST(request: Request) {
    const tCallStart = Date.now();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }

    const validation = validateRenderRequest(body);
    if (!validation.ok) {
        return NextResponse.json(
            { error: "validation failed", details: validation.errors },
            { status: 400 }
        );
    }
    const { comps } = validation.request;

    const imageCheck = await checkImagesExist(comps);
    if (!imageCheck.ok) {
        return NextResponse.json(
            { error: "image files missing or too small", missing: imageCheck.missing },
            { status: 400 }
        );
    }

    // Verify template exists before doing anything.
    try {
        await fs.access(TEMPLATE_PATH);
    } catch {
        return NextResponse.json(
            { error: "template not found", expected: TEMPLATE_PATH },
            { status: 500 }
        );
    }

    let status: { connected: boolean; queueDepth: number };
    try {
        status = await bridgeStatus();
    } catch (e) {
        return NextResponse.json(
            {
                error: "bridge unreachable on 127.0.0.1:3000",
                hint: "start the bridge: cd bridge && node server.js",
                detail: (e as Error).message,
            },
            { status: 503 }
        );
    }
    if (!status.connected) {
        return NextResponse.json(
            {
                error: "bridge says plugin not connected",
                hint: "open InDesign with the Bridge Panel loaded",
            },
            { status: 503 }
        );
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outputPdf = path.join(OUTPUT_DIR, `dashboard-render-${Date.now()}.pdf`);

    const tiles = comps.map((c, i) => ({
        n: i + 1,
        address: c.address,
        city_state: `${c.city}, ${c.state}`,
        sf_ac: formatSfAc(c.building_sf, c.land_area),
        image: path.join(IMAGES_DIR, c.image_filename),
    }));

    let result: BridgeResult | null = null;
    let bridgeError: (Error & { httpStatus?: number }) | null = null;

    try {
        const code = buildBridgeCode(TEMPLATE_PATH, outputPdf, tiles) as string;
        result = (await bridgeExecute(code)) as BridgeResult;
    } catch (e) {
        bridgeError = e as Error & { httpStatus?: number };
    }

    if (bridgeError) {
        return NextResponse.json(
            { error: "bridge call failed", detail: bridgeError.message },
            {
                status:
                    bridgeError.httpStatus && bridgeError.httpStatus >= 400
                        ? bridgeError.httpStatus
                        : 502,
            }
        );
    }

    if (!result || result.ok !== true) {
        return NextResponse.json(
            {
                error: "render returned failure",
                detail: result?.error ?? "unknown",
                pluginResult: result,
            },
            { status: 500 }
        );
    }

    let pdfBytes: Buffer;
    try {
        pdfBytes = await fs.readFile(outputPdf);
    } catch (e) {
        return NextResponse.json(
            {
                error: "render reported success but PDF not found on disk",
                expected: outputPdf,
                detail: (e as Error).message,
            },
            { status: 500 }
        );
    }

    // Best-effort cleanup of the per-request PDF (we have it in memory now).
    bestEffortUnlink(outputPdf).catch(() => {});

    const wallMs = Date.now() - tCallStart;

    return new Response(new Uint8Array(pdfBytes), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(pdfBytes.length),
            "X-Render-Plugin-Total-Ms": String(result.totalMs ?? ""),
            "X-Render-Populate-Ms": String(result.populateMs ?? ""),
            "X-Render-Export-Ms": String(result.exportMs ?? ""),
            "X-Render-Wall-Ms": String(wallMs),
            ...(result.closeWarning
                ? { "X-Render-Close-Warning": result.closeWarning.slice(0, 200) }
                : {}),
        },
    });
}
