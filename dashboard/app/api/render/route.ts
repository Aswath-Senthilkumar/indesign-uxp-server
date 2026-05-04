/**
 * POST /api/render
 *
 * Forwards a render request to the InDesign bridge:
 *   client -> Next.js API route -> bridge (127.0.0.1:3000) -> plugin -> InDesign DOM
 *
 * The browser cannot talk to the bridge directly — bridge binds loopback
 * only and we want to keep that contract. This route is the bridge's
 * caller.
 *
 * Same code shape as test-render.js's batched /execute (Stage 3.7): one
 * code blob populates all six tiles + exports the PDF in a single bridge
 * call. The plugin uses FitOptions.fillProportionally for photos.
 *
 * Output: streams the rendered PDF back as application/pdf so the
 * browser can preview it inline.
 *
 * Note on path safety: same as test-render.js — the bridge's /execute
 * forwards code strings to the plugin verbatim and does not run the
 * Stage 1.5 path validator (which lives in src/handlers/, the MCP-server
 * codebase we are not going through). We resolve to absolute and
 * pre-check existence locally; the only true boundary is InDesign's
 * process-level file permissions.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
    type Comp,
    formatSfAc,
    validateRenderRequest,
} from "@/lib/format";

const BRIDGE_URL = "http://127.0.0.1:3000";
const TEMPLATE_NAME = "template-v2-test.indd";

// The dashboard runs from `dashboard/`. mock-data and the output dir are at
// the repo root, one level up. Allow override via env var for prod-ish setups.
const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const IMAGES_DIR = path.join(REPO_ROOT, "mock-data", "images");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");

type Json = Record<string, unknown>;

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

const lit = (s: string) => JSON.stringify(s);

function buildBridgeCode(
    tiles: Array<{
        n: number;
        address: string;
        city_state: string;
        sf_ac: string;
        image: string;
    }>,
    outputPdf: string
): string {
    return `
        const { FitOptions, ExportFormat } = require('indesign');
        const doc = app.activeDocument;
        if (!doc) return { ok: false, error: 'no active document' };
        if (doc.name !== ${lit(TEMPLATE_NAME)}) {
            return { ok: false, error: 'wrong active document: ' + doc.name };
        }

        const tiles = ${JSON.stringify(tiles)};
        const t0 = Date.now();
        const tileTimes = [];

        for (const t of tiles) {
            const tStart = Date.now();
            const prefix = 'tile_' + t.n + '_';

            const fa = doc.textFrames.itemByName(prefix + 'address');
            if (!fa.isValid) return { ok: false, error: prefix + 'address not found' };
            fa.contents = t.address;

            const fc = doc.textFrames.itemByName(prefix + 'city_state');
            if (!fc.isValid) return { ok: false, error: prefix + 'city_state not found' };
            fc.contents = t.city_state;

            const fs = doc.textFrames.itemByName(prefix + 'sf_ac');
            if (!fs.isValid) return { ok: false, error: prefix + 'sf_ac not found' };
            fs.contents = t.sf_ac;

            const rect = doc.rectangles.itemByName(prefix + 'photo');
            if (!rect.isValid) return { ok: false, error: prefix + 'photo not found' };
            try { rect.place(t.image); }
            catch (e) { return { ok: false, error: 'place failed for tile ' + t.n + ': ' + (e.message || String(e)) }; }
            try { rect.fit(FitOptions.fillProportionally); }
            catch (e) { return { ok: false, error: 'fit failed for tile ' + t.n + ': ' + (e.message || String(e)) }; }

            tileTimes.push({ n: t.n, ms: Date.now() - tStart });
        }

        const populateMs = Date.now() - t0;
        const exportStart = Date.now();
        try {
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
        } catch (e) {
            return { ok: false, error: 'export failed: ' + (e.message || String(e)) };
        }
        const exportMs = Date.now() - exportStart;

        return { ok: true, populateMs, exportMs, totalMs: Date.now() - t0, tileTimes };
    `;
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
                hint: "open InDesign with the Bridge Panel; ensure template-v2-test.indd is the active document",
            },
            { status: 503 }
        );
    }

    // Unique output path so concurrent calls don't clobber each other.
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outputPdf = path.join(
        OUTPUT_DIR,
        `dashboard-render-${Date.now()}.pdf`
    );

    const tiles = comps.map((c, i) => ({
        n: i + 1,
        address: c.address,
        city_state: `${c.city}, ${c.state}`,
        sf_ac: formatSfAc(c.building_sf, c.land_area),
        image: path.join(IMAGES_DIR, c.image_filename),
    }));

    let result: Json;
    try {
        result = (await bridgeExecute(buildBridgeCode(tiles, outputPdf))) as Json;
    } catch (e) {
        const err = e as Error & { httpStatus?: number };
        return NextResponse.json(
            { error: "bridge call failed", detail: err.message },
            { status: err.httpStatus && err.httpStatus >= 400 ? err.httpStatus : 502 }
        );
    }

    if (!result || result.ok !== true) {
        return NextResponse.json(
            {
                error: "render returned failure",
                detail: (result?.error as string) ?? "unknown",
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

    // Best-effort cleanup of the per-request file. Failure here is fine —
    // output/ is gitignored and these are tiny.
    fs.unlink(outputPdf).catch(() => {});

    const wallMs = Date.now() - tCallStart;

    return new Response(new Uint8Array(pdfBytes), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(pdfBytes.length),
            // Surface plugin-side timings so the UI can show "rendered in N ms".
            "X-Render-Plugin-Total-Ms": String(result.totalMs ?? ""),
            "X-Render-Populate-Ms": String(result.populateMs ?? ""),
            "X-Render-Export-Ms": String(result.exportMs ?? ""),
            "X-Render-Wall-Ms": String(wallMs),
        },
    });
}
