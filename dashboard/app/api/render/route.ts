/**
 * POST /api/render
 *
 * Forwards a render request to the InDesign bridge:
 *   client -> Next.js API route -> bridge (127.0.0.1:3000) -> plugin -> InDesign DOM
 *
 * Body shape: { template_id, comps, page_overrides?, tile_count }.
 * template_id is looked up via dashboard/lib/manifest.ts (which scans
 * dashboard/templates/<TemplateName>/manifest.json) to resolve the
 * .indd file path; tile_count is carried by the client from the
 * introspection cache so we don't re-query the bridge here.
 *
 * Per-render isolation: in-memory `OpenOptions.openCopy` (Stage 4.x)
 * for the .indd; on-disk per-render working directory for fetched
 * comp images (Stage 6 Track B). The original template file is never
 * bound, locked, or modified.
 *
 * Stage 6 Track B image flow:
 *   1. For each comp, if image_url is non-null, fetch the bytes via
 *      dashboard/lib/images.ts (process-lifetime cache, 5-min TTL)
 *      and write them to output/working/render-{ts}-{id}/<comp.id>.<ext>.
 *   2. Pass that absolute path to the bridge as the tile's `image`.
 *   3. Comps with null image_url (or fetch failure) get an empty
 *      `image` string — Stage 6 (b) policy: bridge skips place(),
 *      template's default fill (muted grey) shows in the output.
 *   4. After response (success or failure), delete the working dir.
 *
 * Output: streams the rendered PDF back as application/pdf for inline
 * preview in the browser. Per-request PDF on disk is cleaned up after
 * the bytes are read.
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
    formatPriceLine,
    formatSfAc,
    formatStatusBadge,
    validateRenderRequest,
} from "@/lib/format";
import type { Comp } from "@/lib/format";
import { getTemplate } from "@/lib/manifest";
import type { TileField } from "@/lib/manifest";
import { buildBridgeCode } from "@/lib/render-script.mjs";
import { fetchImage } from "@/lib/images";

const BRIDGE_URL = "http://127.0.0.1:3000";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");
const WORKING_DIR = path.join(OUTPUT_DIR, "working");

type Json = Record<string, unknown>;

interface BridgeResult {
    ok: boolean;
    error?: string;
    populateMs?: number;
    exportMs?: number;
    totalMs?: number;
    tileTimes?: Array<{ n: number; ms: number }>;
    tilesWithoutImage?: number[];
    /**
     * Stage 7: appliedOverrides now reports `{ frame, count }` so the
     * caller can see fan-out across multi-page templates (e.g. an 18-tile
     * 2-page template applies a single `page_title` override to two
     * frames, one per page).
     */
    appliedOverrides?: Array<{ frame: string; count: number }>;
    skippedOverrides?: string[];
    closeWarning?: string;
}

interface ImageFetchSummary {
    fetched: number;
    cacheHits: number;
    skippedNull: number;
    failures: Array<{ compId: string; url: string; error: string }>;
    totalMs: number;
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

async function bestEffortRmdir(p: string): Promise<void> {
    try {
        await fs.rm(p, { recursive: true, force: true });
    } catch {
        /* working dir cleanup is non-fatal */
    }
}

/**
 * Resolve a tile field's value from the comp record. Stage 7 made this
 * the single dispatch point for converting comp data into the strings
 * the bridge writes into named frames. Add a new tile field by adding
 * it to the manifest's `tile_fields[]` and adding a case here.
 *
 * Image fields are special-cased: the value is the pre-resolved local
 * filesystem path (or empty string when the comp has no usable image,
 * per Stage 6 (b)), since the route owns image fetching/staging.
 */
function resolveTileFieldValue(
    field: string,
    comp: Comp,
    imagePath: string
): string {
    switch (field) {
        case "address":
            return comp.address;
        case "city_state":
            return `${comp.city}, ${comp.state}`;
        case "sf_ac":
            return formatSfAc(comp.building_sf, comp.land_area);
        case "price":
            return formatPriceLine({
                sale_price: comp.sale_price,
                base_rent_total: comp.base_rent_total,
                lease_format: comp.lease_format,
            });
        case "status":
            return formatStatusBadge(comp.status);
        case "photo":
            return imagePath;
        default:
            throw new Error(
                `unknown tile field "${field}" — declared in manifest but no resolver in dashboard/app/api/render/route.ts`
            );
    }
}

interface BridgeTileField {
    key: string;
    type: "text" | "image";
    value: string;
}

/**
 * Build the per-tile bridge payload from the manifest's tile_fields[]
 * declaration. The bridge code is field-agnostic — it dispatches on
 * `type` to either set text contents or place an image. Manifest order
 * controls evaluation order; field name controls the InDesign frame
 * name (`tile_N_<key>`).
 */
function buildTileFields(
    fieldDefs: TileField[],
    comp: Comp,
    imagePath: string
): BridgeTileField[] {
    return fieldDefs.map((fd) => ({
        key: fd.field,
        type: fd.type,
        value: resolveTileFieldValue(fd.field, comp, imagePath),
    }));
}

/**
 * Resolve each comp's image to either an absolute filesystem path
 * (after fetching + writing into the working dir) or "" (Stage 6 (b):
 * leave the photo frame blank). Failures are captured per-comp and
 * surfaced in the response headers; they don't fail the render.
 */
async function fetchAndStageImages(
    comps: Comp[],
    workingDir: string
): Promise<{ paths: string[]; summary: ImageFetchSummary }> {
    const tStart = Date.now();
    const paths: string[] = [];
    const summary: ImageFetchSummary = {
        fetched: 0,
        cacheHits: 0,
        skippedNull: 0,
        failures: [],
        totalMs: 0,
    };

    for (const c of comps) {
        if (!c.image_url) {
            summary.skippedNull++;
            paths.push("");
            continue;
        }
        try {
            const img = await fetchImage(c.image_url);
            if (img.cacheHit) summary.cacheHits++;
            else summary.fetched++;
            const filename = `${c.id}.${img.ext}`;
            const abs = path.join(workingDir, filename);
            await fs.writeFile(abs, img.bytes);
            paths.push(abs);
        } catch (e) {
            summary.failures.push({
                compId: c.id,
                url: c.image_url,
                error: (e as Error).message,
            });
            // Treat fetch failure the same as null per (b) policy:
            // empty path -> bridge skips place().
            paths.push("");
        }
    }

    summary.totalMs = Date.now() - tStart;
    return { paths, summary };
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
    await fs.mkdir(WORKING_DIR, { recursive: true });
    const renderId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const renderDir = path.join(WORKING_DIR, `render-${renderId}`);
    await fs.mkdir(renderDir, { recursive: true });
    const outputPdf = path.join(OUTPUT_DIR, `dashboard-render-${renderId}.pdf`);

    try {
        const { paths: imagePaths, summary: imageSummary } =
            await fetchAndStageImages(comps, renderDir);

        const tiles = comps.map((c, i) => ({
            n: i + 1,
            fields: buildTileFields(tpl.tile_fields, c, imagePaths[i]),
        }));

        // Translate page_overrides keyed by manifest field name to the bridge's
        // (frame, value) shape. Only fields that exist in the manifest's
        // page_fields and are marked editable are forwarded. Empty strings
        // are skipped (treat empty input as "leave the template default alone").
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
            const code = buildBridgeCode(
                templatePath,
                outputPdf,
                tiles,
                bridgeOverrides
            ) as string;
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
        const tilesBlankedFromImageFail = result.tilesWithoutImage ?? [];

        return new Response(new Uint8Array(pdfBytes), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(pdfBytes.length),
                "X-Render-Plugin-Total-Ms": String(result.totalMs ?? ""),
                "X-Render-Populate-Ms": String(result.populateMs ?? ""),
                "X-Render-Export-Ms": String(result.exportMs ?? ""),
                "X-Render-Wall-Ms": String(wallMs),
                "X-Render-Image-Fetch-Ms": String(imageSummary.totalMs),
                "X-Render-Image-Fetched": String(imageSummary.fetched),
                "X-Render-Image-Cache-Hits": String(imageSummary.cacheHits),
                ...(imageSummary.skippedNull > 0
                    ? { "X-Render-Image-Skipped-Null": String(imageSummary.skippedNull) }
                    : {}),
                ...(imageSummary.failures.length > 0
                    ? {
                          "X-Render-Image-Failures": String(
                              imageSummary.failures.length
                          ),
                      }
                    : {}),
                ...(tilesBlankedFromImageFail.length > 0
                    ? {
                          "X-Render-Tiles-Blank": tilesBlankedFromImageFail.join(","),
                      }
                    : {}),
                ...(result.appliedOverrides && result.appliedOverrides.length > 0
                    ? {
                          "X-Render-Applied-Overrides": result.appliedOverrides
                              .map((o) => `${o.frame}:${o.count}`)
                              .join(","),
                      }
                    : {}),
                ...(result.skippedOverrides && result.skippedOverrides.length > 0
                    ? { "X-Render-Skipped-Overrides": result.skippedOverrides.join(",") }
                    : {}),
                ...(result.closeWarning
                    ? { "X-Render-Close-Warning": result.closeWarning.slice(0, 200) }
                    : {}),
            },
        });
    } finally {
        bestEffortRmdir(renderDir).catch(() => {});
    }
}
