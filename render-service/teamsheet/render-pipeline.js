/**
 * End-to-end render orchestration. Called by routes/render.js.
 *
 * Inputs: validated `{ template_id, comp_ids, page_overrides }`. The
 * pipeline:
 *   1. Look up the template manifest entry.
 *   2. Resolve the .indd path against repoRoot and check it exists.
 *   3. Pre-flight bridge connectivity.
 *   4. Read each comp by id from Supabase, ordered by `comp_ids`.
 *   5. Stage images into a per-render working dir.
 *   6. Build per-tile bridge payload.
 *   7. Translate page_overrides into bridge (frame, value) tuples.
 *   8. Execute the build via the bridge; read the PDF bytes back.
 *   9. Clean up the working dir and the on-disk PDF.
 *
 * Returns an object with `{ pdf, headers, bridgeResult, imageSummary,
 * wallMs }`. The route handler shapes this into the HTTP response.
 *
 * Throws domain-tagged errors so the route can map them to status codes:
 *   - `TEMPLATE_UNKNOWN`     -> 404
 *   - `TEMPLATE_FILE_MISSING`-> 500
 *   - `BRIDGE_UNREACHABLE`   -> 503
 *   - `BRIDGE_DISCONNECTED`  -> 503
 *   - `BRIDGE_FAILED`        -> 502 (preserves upstream HTTP status)
 *   - `COMP_MISSING`         -> 400 (with `.missing` array)
 *   - `COMP_COUNT_MISMATCH`  -> 400
 *   - `RENDER_FAILED`        -> 500
 *   - `PDF_MISSING`          -> 500
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import config from "../config.js";
import { getTemplate } from "../core/manifest.js";
import { getCompsByIds } from "../core/comps.js";
import { fetchImage } from "../core/images.js";
import { bridgeStatus, bridgeExecute } from "../core/bridge-client.js";
import { buildBridgeCode } from "../core/render-script.mjs";
import { getTemplateIntrospection } from "../core/template-introspect.js";
import { resolveTemplatePath } from "../core/template-paths.js";
import { buildTileFields } from "./tile-builder.js";
import { mergeTileOverrides } from "./merge-overrides.js";

function tagged(code, message, extra = {}) {
    const err = new Error(message);
    err.code = code;
    Object.assign(err, extra);
    return err;
}

async function bestEffortUnlink(p) {
    try {
        await fs.unlink(p);
    } catch {
        /* output/ is gitignored */
    }
}

async function bestEffortRmdir(p) {
    try {
        await fs.rm(p, { recursive: true, force: true });
    } catch {
        /* working dir cleanup is non-fatal */
    }
}

async function fetchAndStageImages(comps, workingDir) {
    const tStart = Date.now();
    const paths = [];
    const summary = {
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
                error: e.message,
            });
            // Fetch failure is treated the same as null image_url:
            // empty path -> bridge skips place() and renders a grey
            // placeholder. Failures still surface in X-Render-* headers.
            paths.push("");
        }
    }

    summary.totalMs = Date.now() - tStart;
    return { paths, summary };
}

/**
 * @param {{
 *   template_id: string,
 *   comp_ids: string[],
 *   page_overrides: Record<string,string>,
 *   tile_overrides?: Record<string, Record<string, string|number|null>>
 * }} req
 */
export async function runRender(req) {
    const tCallStart = Date.now();
    const { template_id, comp_ids, page_overrides, tile_overrides } = req;

    const tpl = await getTemplate(template_id);
    if (!tpl) {
        throw tagged("TEMPLATE_UNKNOWN", `unknown template_id: ${template_id}`);
    }

    const templatePath = resolveTemplatePath(tpl);
    try {
        await fs.access(templatePath);
    } catch {
        throw tagged(
            "TEMPLATE_FILE_MISSING",
            "template file not found",
            { expected: templatePath }
        );
    }

    // Bridge pre-flight. Uses the introspection helper indirectly via
    // bridgeStatus(); separated so the connectivity error message is
    // distinct from a 503-from-disconnected-plugin.
    let status;
    try {
        status = await bridgeStatus();
    } catch (e) {
        throw tagged(
            "BRIDGE_UNREACHABLE",
            `bridge unreachable at ${config.bridgeUrl}`,
            { hint: "start the bridge: cd bridge && node server.js", detail: e.message }
        );
    }
    if (!status.connected) {
        throw tagged("BRIDGE_DISCONNECTED", "bridge says plugin not connected", {
            hint: "open InDesign with the Bridge Panel loaded",
        });
    }

    // Tile-count validation requires introspecting the template. The
    // introspection result is cached per template id, so this only hits
    // the bridge once per template per process restart.
    const intro = await getTemplateIntrospection(tpl);
    if (comp_ids.length !== intro.tileCount) {
        throw tagged(
            "COMP_COUNT_MISMATCH",
            `expected ${intro.tileCount} comp_ids (per template tile_count), got ${comp_ids.length}`,
            { expected: intro.tileCount, actual: comp_ids.length }
        );
    }

    const { comps, missing } = await getCompsByIds(comp_ids);
    if (missing.length > 0) {
        throw tagged(
            "COMP_MISSING",
            `unknown comp_ids: ${missing.join(", ")}`,
            { missing }
        );
    }

    // Phase 3: sparse-merge per-tile overrides on top of the DB rows.
    // An override `image_url` flows naturally into fetchAndStageImages
    // since the merged comp carries the new URL; the existing 5-min
    // cache keys on URL, so a fresh override URL misses cache.
    // mergedComps has the same Comp shape, same length, same order.
    const { mergedComps, overrideApplied } = mergeTileOverrides(
        comps,
        tile_overrides
    );

    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.mkdir(config.workingDir, { recursive: true });
    const renderId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const renderDir = path.join(config.workingDir, `render-${renderId}`);
    await fs.mkdir(renderDir, { recursive: true });
    const outputPdf = path.join(config.outputDir, `render-${renderId}.pdf`);

    try {
        const { paths: imagePaths, summary: imageSummary } =
            await fetchAndStageImages(mergedComps, renderDir);

        const tiles = mergedComps.map((c, i) => ({
            n: i + 1,
            fields: buildTileFields(tpl.tile_fields, c, imagePaths[i]),
        }));

        // Translate page_overrides keyed by manifest field name into the
        // bridge's (frame, value) shape. Only fields that exist in the
        // manifest's page_fields AND are marked editable are forwarded.
        // Empty strings are skipped (treat empty input as "leave the
        // template default alone").
        const editableByField = new Map();
        for (const pf of tpl.page_fields) {
            if (pf.editable) editableByField.set(pf.field, pf.frame);
        }
        const bridgeOverrides = [];
        for (const [field, value] of Object.entries(page_overrides ?? {})) {
            const frame = editableByField.get(field);
            if (frame && value.length > 0) {
                bridgeOverrides.push({ frame, value });
            }
        }

        let result;
        try {
            const code = buildBridgeCode(
                templatePath,
                outputPdf,
                tiles,
                bridgeOverrides
            );
            result = await bridgeExecute(code);
        } catch (e) {
            throw tagged(
                "BRIDGE_FAILED",
                e.message || "bridge call failed",
                { httpStatus: e.httpStatus }
            );
        }

        if (!result || result.ok !== true) {
            throw tagged("RENDER_FAILED", "render returned failure", {
                detail: result?.error ?? "unknown",
                pluginResult: result,
            });
        }

        let pdfBytes;
        try {
            pdfBytes = await fs.readFile(outputPdf);
        } catch (e) {
            throw tagged(
                "PDF_MISSING",
                "render reported success but PDF not found on disk",
                { expected: outputPdf, detail: e.message }
            );
        }

        bestEffortUnlink(outputPdf).catch(() => {});

        const wallMs = Date.now() - tCallStart;

        return {
            pdf: pdfBytes,
            wallMs,
            imageSummary,
            bridgeResult: result,
            overrideApplied,
        };
    } finally {
        bestEffortRmdir(renderDir).catch(() => {});
    }
}
