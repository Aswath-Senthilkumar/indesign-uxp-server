/**
 * POST /render
 *
 * Contract (new in Phase 1 — IDs-only):
 *   {
 *     template_id:    string,
 *     comp_ids:       string[],                ORDERED (tile_N = comp_ids[N-1])
 *     page_overrides: Record<string, string>?  user-entered page text
 *   }
 *
 * Response: application/pdf byte stream with X-Render-* headers (same
 * accounting metadata the dashboard route used to send).
 *
 * The backend is the single source of truth for comp data: it reads
 * each comp's full row from Supabase by id. Order of `comp_ids` maps
 * directly to tile order — swapping two ids swaps the corresponding
 * tiles.
 */

import express from "express";
import { runRender } from "../render-pipeline.js";
import { validateRenderRequest } from "../validate.js";

const router = express.Router();

router.post("/render", async (req, res) => {
    const validation = validateRenderRequest(req.body);
    if (!validation.ok) {
        return res.status(400).json({
            error: "validation failed",
            details: validation.errors,
        });
    }

    try {
        const { pdf, wallMs, imageSummary, bridgeResult, overrideApplied } =
            await runRender(validation.request);

        const tilesBlank = bridgeResult.tilesWithoutImage ?? [];
        const headers = {
            "Content-Type": "application/pdf",
            "Content-Length": String(pdf.length),
            "X-Render-Plugin-Total-Ms": String(bridgeResult.totalMs ?? ""),
            "X-Render-Populate-Ms": String(bridgeResult.populateMs ?? ""),
            "X-Render-Export-Ms": String(bridgeResult.exportMs ?? ""),
            "X-Render-Wall-Ms": String(wallMs),
            "X-Render-Image-Fetch-Ms": String(imageSummary.totalMs),
            "X-Render-Image-Fetched": String(imageSummary.fetched),
            "X-Render-Image-Cache-Hits": String(imageSummary.cacheHits),
        };
        if (imageSummary.skippedNull > 0) {
            headers["X-Render-Image-Skipped-Null"] = String(imageSummary.skippedNull);
        }
        if (imageSummary.failures.length > 0) {
            headers["X-Render-Image-Failures"] = String(imageSummary.failures.length);
        }
        if (tilesBlank.length > 0) {
            headers["X-Render-Tiles-Blank"] = tilesBlank.join(",");
        }
        if (bridgeResult.appliedOverrides && bridgeResult.appliedOverrides.length > 0) {
            headers["X-Render-Applied-Overrides"] = bridgeResult.appliedOverrides
                .map((o) => `${o.frame}:${o.count}`)
                .join(",");
        }
        if (bridgeResult.skippedOverrides && bridgeResult.skippedOverrides.length > 0) {
            headers["X-Render-Skipped-Overrides"] = bridgeResult.skippedOverrides.join(",");
        }
        if (bridgeResult.closeWarning) {
            headers["X-Render-Close-Warning"] = bridgeResult.closeWarning.slice(0, 200);
        }
        // Phase 3: surface which overrides made it through merge. Only
        // emitted when at least one override produced count > 0; an
        // empty tile_overrides or all-empty per-comp maps stay silent
        // so backward-compat callers see no new header.
        if (overrideApplied && overrideApplied.size > 0) {
            headers["X-Render-Tile-Overrides-Applied"] = [...overrideApplied]
                .map(([id, n]) => `${id}:${n}`)
                .join(",");
        }

        res.set(headers);
        return res.end(pdf);
    } catch (e) {
        switch (e.code) {
            case "TEMPLATE_UNKNOWN":
                return res.status(404).json({ error: e.message });
            case "TEMPLATE_FILE_MISSING":
                return res.status(500).json({
                    error: "template file not found",
                    expected: e.expected,
                });
            case "BRIDGE_UNREACHABLE":
                return res.status(503).json({
                    error: e.message,
                    hint: e.hint,
                    detail: e.detail,
                });
            case "BRIDGE_DISCONNECTED":
                return res.status(503).json({ error: e.message, hint: e.hint });
            case "BRIDGE_FAILED":
                return res.status(
                    e.httpStatus && e.httpStatus >= 400 ? e.httpStatus : 502
                ).json({
                    error: "bridge call failed",
                    detail: e.message,
                });
            case "COMP_COUNT_MISMATCH":
                return res.status(400).json({
                    error: e.message,
                    expected: e.expected,
                    actual: e.actual,
                });
            case "COMP_MISSING":
                return res.status(400).json({
                    error: e.message,
                    missing: e.missing,
                });
            case "RENDER_FAILED":
                return res.status(500).json({
                    error: "render returned failure",
                    detail: e.detail,
                    pluginResult: e.pluginResult,
                });
            case "PDF_MISSING":
                return res.status(500).json({
                    error: "render reported success but PDF not found on disk",
                    expected: e.expected,
                    detail: e.detail,
                });
            default:
                console.error("[render] unhandled error:", e);
                return res.status(500).json({
                    error: "internal error",
                    detail: e.message,
                });
        }
    }
});

export default router;
