/**
 * POST /api/render
 *
 * Forwards a render request to the InDesign bridge:
 *   client -> Next.js API route -> bridge (127.0.0.1:3000) -> plugin -> InDesign DOM
 *
 * Stage 5.4 changes:
 *   - Body now uses { template_id, comps, page_overrides?, tile_count }.
 *     template_id is looked up via dashboard/lib/manifest.ts (which scans
 *     dashboard/templates/<TemplateName>/manifest.json) to resolve the
 *     .indd file path; tile_count is carried by the client from the
 *     introspection cache so we don't re-query the bridge here.
 *   - page_overrides is an optional map of frame name -> override text;
 *     applied after the per-tile populate, before export. See
 *     dashboard/lib/render-script.mjs for the bridge-side handling.
 *
 * Per-render isolation: in-memory `OpenOptions.openCopy` (Stage 4.x).
 * The original template file is never bound, locked, or modified.
 *
 * Output: streams the rendered PDF back as application/pdf for inline
 * preview in the browser. Per-request PDF on disk is cleaned up after
 * the bytes are read.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
    formatSfAc,
    validateRenderRequest,
} from "@/lib/format";
import { getTemplate } from "@/lib/manifest";
import { buildBridgeCode } from "@/lib/render-script.mjs";

const BRIDGE_URL = "http://127.0.0.1:3000";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");

type Json = Record<string, unknown>;

interface BridgeResult {
    ok: boolean;
    error?: string;
    populateMs?: number;
    exportMs?: number;
    totalMs?: number;
    tileTimes?: Array<{ n: number; ms: number }>;
    appliedOverrides?: string[];
    skippedOverrides?: string[];
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

async function bestEffortUnlink(p: string): Promise<void> {
    try {
        await fs.unlink(p);
    } catch {
        /* output/ is gitignored and these are tiny */
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
    const { template_id, comps, page_overrides } = validation.request;

    // Manifest lookup -> file path
    const tpl = await getTemplate(template_id);
    if (!tpl) {
        return NextResponse.json(
            { error: `unknown template_id: ${template_id}` },
            { status: 404 }
        );
    }
    const templatePath = path.resolve(REPO_ROOT, tpl.file);
    try {
        await fs.access(templatePath);
    } catch {
        return NextResponse.json(
            { error: "template file not found", expected: templatePath },
            { status: 500 }
        );
    }

    // Stage 6 Track A interim: the v1 local-image existence check is
    // gone — comps now carry remote URLs (or null). Track B replaces
    // this with a fetch-and-write step plus its own error reporting
    // for missing/404 images.

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

    // Stage 6 Track A interim: comps now carry image_url (Supabase
    // storage URL or null), not a local image_filename. The bridge
    // still expects a filesystem path. Track B replaces this block
    // with: fetch each image_url -> write to a per-render temp dir ->
    // pass that path here. Until Track B lands, we pass image_url
    // through unchanged so the route compiles; an actual /api/render
    // call will fail at the InDesign place() step with a clear error,
    // which is the expected mid-Stage-6 state.
    const tiles = comps.map((c, i) => ({
        n: i + 1,
        address: c.address,
        city_state: `${c.city}, ${c.state}`,
        sf_ac: formatSfAc(c.building_sf, c.land_area),
        image: c.image_url ?? "",
    }));

    // Translate page_overrides keyed by manifest field name to the bridge's
    // (frame, value) shape. Only fields that exist in the manifest's
    // page_fields and are marked editable are forwarded — anything else the
    // client might send is ignored. Empty strings are skipped (treat empty
    // input as "leave the template default alone").
    const editableByField = new Map<string, string>();
    for (const pf of tpl.page_fields) {
        if (pf.editable) editableByField.set(pf.field, pf.frame);
    }
    const bridgeOverrides: Array<{ frame: string; value: string }> = [];
    for (const [field, value] of Object.entries(page_overrides ?? {})) {
        const frame = editableByField.get(field);
        if (frame && value.length > 0) {
            bridgeOverrides.push({ frame, value });
        }
    }

    let result: BridgeResult | null = null;
    let bridgeError: (Error & { httpStatus?: number }) | null = null;

    try {
        const code = buildBridgeCode(templatePath, outputPdf, tiles, bridgeOverrides) as string;
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
            ...(result.appliedOverrides && result.appliedOverrides.length > 0
                ? { "X-Render-Applied-Overrides": result.appliedOverrides.join(",") }
                : {}),
            ...(result.skippedOverrides && result.skippedOverrides.length > 0
                ? { "X-Render-Skipped-Overrides": result.skippedOverrides.join(",") }
                : {}),
            ...(result.closeWarning
                ? { "X-Render-Close-Warning": result.closeWarning.slice(0, 200) }
                : {}),
        },
    });
}
