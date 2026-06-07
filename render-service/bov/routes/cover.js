/**
 * POST /bov/cover/render
 *
 * Renders the BOV Cover template (2 pages: cover + TOC).
 *
 * Body (JSON):
 *   cover_date              string | null
 *   client_name             string | null
 *   client_property_address string | null
 *   cover_image_path        string | null  — absolute path to a pre-staged image
 *   section6_disabled       string[]       — frame names to remove from the TOC
 *
 * Response: application/pdf binary
 */

import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { bridgeExecute } from "../../core/bridge-client.js";
import { resolveTemplatePath } from "../../core/template-paths.js";
import config from "../../config.js";

const router = Router();

const COVER_MANIFEST = { id: "bov-cover", file: "BOV - Cover.indd" };

const SECTION6_TOGGLEABLE = [
    "sections_6_recent_industrial_transactions",
    "sections_6_recent_heavy_industrial_transactions",
    "sections_6_nw_phoenix_transactions",
    "sections_6_sw_phoenix_transactions",
    "sections_6_sky_harbor_transactions",
];

function buildBridgeCode(templatePath, outputPdf, fields, imagePath, section6Disabled) {
    const lit = JSON.stringify;

    const textOverrides = [];
    if (fields.cover_date)              textOverrides.push({ frame: "cover_date",              value: fields.cover_date });
    if (fields.client_name)             textOverrides.push({ frame: "client_name",             value: fields.client_name });
    if (fields.client_property_address) textOverrides.push({ frame: "client_property_address", value: fields.client_property_address });

    return `
        const { SaveOptions, UserInteractionLevels, OpenOptions, ExportFormat, FitOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;
        let doc; let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('no doc after open');

            // Text overrides — paragraph style owns the color, no manual restoration needed.
            const overrides = ${lit(textOverrides)};
            for (const ov of overrides) {
                const tf = doc.textFrames.itemByName(ov.frame);
                if (tf.isValid) tf.contents = ov.value;
            }

            // Cover image (optional replacement)
            ${imagePath ? `
            const imgRect = doc.rectangles.itemByName('cover_image');
            if (imgRect.isValid) {
                try { imgRect.place(${lit(imagePath)}); imgRect.fit(FitOptions.fillProportionally); }
                catch(e) { /* non-fatal — keep template default */ }
            }` : ""}

            // Section 6 TOC: remove disabled frames, reposition survivors and items below.
            // Snapshot is intentionally limited to the five KNOWN toggleable frame names so
            // the shift logic can never accidentally reach the cover-page fields (date etc.).
            const disabled = ${lit(section6Disabled)};
            const s6Names  = ${lit(SECTION6_TOGGLEABLE)};
            if (disabled.length > 0) {
                const tocPage  = doc.pages.item(1);
                const allItems = tocPage.allPageItems;

                // Snapshot only the known section-6 toggleable frames
                const snapshot = [];
                for (let i = 0; i < allItems.length; i++) {
                    try {
                        const item = allItems[i];
                        if (s6Names.indexOf(item.name) === -1) continue;
                        snapshot.push({ item, name: item.name, bounds: item.geometricBounds.slice() });
                    } catch(e) {}
                }

                // Delete disabled frames
                const removed = snapshot.filter(e => disabled.indexOf(e.name) !== -1);
                for (const r of removed) {
                    try { r.item.remove(); } catch(e) {}
                }

                // Shift surviving section-6 frames: compare removed frame TOP to entry TOP
                // (not bottom) so slight edge-overlaps in the template never cause asymmetric shifts.
                for (const entry of snapshot) {
                    try { if (!entry.item.isValid) continue; } catch(e) { continue; }
                    let shift = 0;
                    for (const r of removed) {
                        if (r.bounds[0] < entry.bounds[0]) shift += (r.bounds[2] - r.bounds[0]);
                    }
                    if (shift > 0.001) {
                        const b = entry.bounds;
                        entry.item.geometricBounds = [b[0] - shift, b[1], b[2] - shift, b[3]];
                    }
                }

                // Shift everything on the TOC page that sits below the last section-6 frame
                // (agent qualifications, contacts, etc.) by the total removed height.
                const totalRemovedH = removed.reduce((sum, r) => sum + (r.bounds[2] - r.bounds[0]), 0);
                if (totalRemovedH > 0.001 && snapshot.length > 0) {
                    const lastS6Bottom = Math.max(...snapshot.map(e => e.bounds[2]));
                    for (let i = 0; i < allItems.length; i++) {
                        try {
                            const item = allItems[i];
                            if (!item.isValid) continue;
                            if (s6Names.indexOf(item.name) !== -1) continue; // already handled
                            const b = item.geometricBounds;
                            if (b[0] >= lastS6Bottom - 0.5) {
                                item.geometricBounds = [b[0] - totalRemovedH, b[1], b[2] - totalRemovedH, b[3]];
                            }
                        } catch(e) {}
                    }
                }
            }

            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            result = { ok: true };
        } catch(e) {
            result = { ok: false, error: e.message };
        }
        if (doc) { try { await doc.close(SaveOptions.no); } catch(e) {} }
        return result;
    `;
}

router.post("/cover/render", async (req, res) => {
    const {
        cover_date,
        client_name,
        client_property_address,
        cover_image_path,
        section6_disabled,
    } = req.body;

    const templatePath = resolveTemplatePath(COVER_MANIFEST);
    try { await fs.access(templatePath); } catch {
        return res.status(503).json({
            error: "BOV Cover template not found",
            expected: templatePath,
            hint: "Drop BOV - Cover.indd into TEMPLATES_DIR and restart.",
        });
    }

    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.mkdir(config.workingDir, { recursive: true });

    const renderId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const outputPdf = path.join(config.outputDir, `bov-cover-${renderId}.pdf`);

    const disabled = (Array.isArray(section6_disabled) ? section6_disabled : [])
        .filter(f => SECTION6_TOGGLEABLE.includes(f));

    const code = buildBridgeCode(
        templatePath,
        outputPdf,
        {
            cover_date:              cover_date              || null,
            client_name:             client_name             || null,
            client_property_address: client_property_address || null,
        },
        cover_image_path || null,
        disabled
    );

    let bridgeResult;
    try {
        bridgeResult = await bridgeExecute(code);
    } catch (e) {
        return res.status(502).json({ error: "bridge failed", detail: e.message });
    }

    if (!bridgeResult || bridgeResult.ok !== true) {
        return res.status(500).json({ error: "render failed", detail: bridgeResult?.error ?? "unknown" });
    }

    let pdfBytes;
    try {
        pdfBytes = await fs.readFile(outputPdf);
    } catch (e) {
        return res.status(500).json({ error: "pdf not found after render", detail: e.message });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(pdfBytes);

    // Clean up the staged PDF after sending
    fs.unlink(outputPdf).catch(() => {});
});

export default router;
