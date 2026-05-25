/**
 * GET /preview?template_id=<id>
 *
 * Renders the named template AS-IS (no tile data populated) and streams
 * the PDF back inline. Used by the template-card "Preview" UX in the
 * dashboard.
 *
 * Same isolation model as /render: opens via OpenOptions.openCopy so
 * the original template file is never bound or modified.
 */

import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getTemplate } from "../core/manifest.js";
import { bridgeStatus, bridgeExecute } from "../core/bridge-client.js";
import { resolveTemplatePath } from "../core/template-paths.js";
import config from "../config.js";

const router = express.Router();

const lit = (s) => JSON.stringify(s);

function buildPreviewCode(templatePath, outputPdf) {
    return `
        const { ExportFormat, SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('app.open returned no document');
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            result = { ok: true };
        } catch (e) {
            result = { ok: false, error: e.message || String(e) };
        }
        if (doc) {
            try { await doc.close(SaveOptions.no); } catch (e) { /* swallow */ }
        }
        return result;
    `;
}

router.get("/preview", async (req, res) => {
    const template_id =
        typeof req.query.template_id === "string" ? req.query.template_id : "";
    if (!template_id) {
        return res.status(400).json({
            error: "template_id query parameter is required",
        });
    }

    const tpl = await getTemplate(template_id);
    if (!tpl) {
        return res.status(404).json({
            error: `unknown template id: ${template_id}`,
        });
    }

    const templatePath = resolveTemplatePath(tpl);
    try {
        await fs.access(templatePath);
    } catch {
        return res.status(500).json({
            error: "template file not found",
            expected: templatePath,
        });
    }

    // Bridge connectivity check up front so we don't generate temp paths
    // pointlessly.
    try {
        const s = await bridgeStatus();
        if (!s.connected) {
            return res.status(503).json({
                error: "bridge says plugin not connected",
                hint: "open InDesign with the Bridge Panel loaded",
            });
        }
    } catch (e) {
        return res.status(503).json({
            error: `bridge unreachable at ${config.bridgeUrl}`,
            hint: "start the bridge: cd bridge && node server.js",
            detail: e.message,
        });
    }

    await fs.mkdir(config.outputDir, { recursive: true });
    const outputPdf = path.join(
        config.outputDir,
        `template-preview-${template_id}-${Date.now()}.pdf`
    );

    let result;
    try {
        result = await bridgeExecute(buildPreviewCode(templatePath, outputPdf));
    } catch (e) {
        const status = e.code === "BRIDGE_UNREACHABLE" ? 503 : 502;
        return res.status(status).json({
            error: "bridge call failed",
            detail: e.message,
        });
    }

    if (!result || result.ok !== true) {
        return res.status(500).json({
            error: "preview render failed",
            detail: result?.error ?? "unknown",
        });
    }

    let pdfBytes;
    try {
        pdfBytes = await fs.readFile(outputPdf);
    } catch (e) {
        return res.status(500).json({
            error: "preview reported success but PDF not found on disk",
            expected: outputPdf,
            detail: e.message,
        });
    }

    fs.unlink(outputPdf).catch(() => {
        /* output/ is gitignored */
    });

    res.set({
        "Content-Type": "application/pdf",
        "Content-Length": String(pdfBytes.length),
        "Content-Disposition": `inline; filename="${tpl.label.replace(/[^A-Za-z0-9 _.-]/g, "_")}.pdf"`,
        "Cache-Control": "private, max-age=10",
    });
    return res.end(pdfBytes);
});

export default router;
