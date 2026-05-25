/**
 * GET /page-fields?template_id=<id>
 *
 * Reads current contents of editable page_fields declared in the
 * manifest. Returns
 *   { fields: [{ field, frame, label, current_value, missing }] }
 *
 * Empty case: when the manifest declares no editable page fields, the
 * route short-circuits with `{ fields: [] }` without touching the
 * bridge (matches the dashboard's existing behavior).
 */

import express from "express";
import { promises as fs } from "node:fs";
import { getTemplate } from "../../core/manifest.js";
import { bridgeStatus, bridgeExecute } from "../../core/bridge-client.js";
import { resolveTemplatePath } from "../../core/template-paths.js";
import config from "../../config.js";

const router = express.Router();

const lit = (s) => JSON.stringify(s);

function buildReadbackCode(templatePath, fields) {
    return `
        const { SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

        const fields = ${JSON.stringify(fields)};
        const out = {};
        const missing = [];

        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('app.open returned no document');

            for (const f of fields) {
                const frame = doc.textFrames.itemByName(f.frame);
                if (frame.isValid) {
                    out[f.field] = frame.contents || '';
                } else {
                    missing.push(f.frame);
                }
            }
            result = { ok: true, fields: out, missing };
        } catch (e) {
            result = { ok: false, error: e.message || String(e) };
        }

        if (doc) {
            try { await doc.close(SaveOptions.no); } catch (e) { /* swallow */ }
        }
        return result;
    `;
}

function humanize(field) {
    return field
        .split("_")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
}

router.get("/page-fields", async (req, res) => {
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

    const editableFields = tpl.page_fields
        .filter((f) => f.editable)
        .map((f) => ({ field: f.field, frame: f.frame }));

    // Short-circuit: no bridge call when nothing is editable.
    if (editableFields.length === 0) {
        return res.json({ fields: [] });
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

    // Bridge connectivity check
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

    let result;
    try {
        result = await bridgeExecute(buildReadbackCode(templatePath, editableFields));
    } catch (e) {
        const status = e.code === "BRIDGE_UNREACHABLE" ? 503 : 502;
        return res.status(status).json({
            error: "bridge call failed",
            detail: e.message,
        });
    }

    if (!result || result.ok !== true) {
        return res.status(500).json({
            error: "page-fields readback failed",
            detail: result?.error ?? "unknown",
        });
    }

    const values = result.fields ?? {};
    const missingSet = new Set(result.missing ?? []);
    const merged = editableFields.map(({ field, frame }) => ({
        field,
        frame,
        label: humanize(field),
        current_value: values[field] ?? "",
        missing: missingSet.has(frame),
    }));

    res.set("Cache-Control", "private, max-age=30");
    return res.json({ fields: merged });
});

export default router;
