/**
 * POST /introspect  { template_id }
 *
 * Returns `{ tileCount, templatePath, gridCols?, tileFieldNames? }`.
 * Mirrors the dashboard's `/api/templates/[id]/introspect` route, with
 * `template_id` moved into the JSON body so the path can be flat.
 */

import express from "express";
import { getTemplate } from "../../core/manifest.js";
import { getTemplateIntrospection } from "../../core/template-introspect.js";
import { bridgeStatus } from "../../core/bridge-client.js";
import config from "../../config.js";

const router = express.Router();

router.post("/introspect", async (req, res) => {
    const template_id = req.body?.template_id;
    if (typeof template_id !== "string" || template_id.length === 0) {
        return res.status(400).json({
            error: "template_id is required in JSON body",
        });
    }

    const tpl = await getTemplate(template_id);
    if (!tpl) {
        return res.status(404).json({
            error: `unknown template id: ${template_id}`,
        });
    }

    // Pre-flight bridge so a missing plugin returns 503 with the
    // configured URL rather than masquerading as a 500.
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

    try {
        const result = await getTemplateIntrospection(tpl);
        return res.json({
            tileCount: result.tileCount,
            templatePath: result.templatePath,
            gridCols: tpl.grid?.cols,
            tileFieldNames: tpl.tile_fields.map((f) => f.field),
        });
    } catch (e) {
        const msg = e.message || String(e);
        const isBridge =
            msg.startsWith("bridge unreachable") ||
            msg.startsWith("bridge returned");
        return res.status(isBridge ? 502 : 500).json({
            error: "introspection failed",
            detail: msg,
        });
    }
});

export default router;
