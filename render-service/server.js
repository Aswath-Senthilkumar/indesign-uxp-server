/**
 * Render service entry. Wires Express routes and starts the HTTP
 * listener. The service is a CLIENT of the bridge — it does not own
 * the WebSocket to the UXP plugin.
 *
 * Layout (post-restructure 2026-05-16):
 *   - core/     shared substrate (bridge client, supabase, manifest,
 *               images, render-script, template-introspect, auth,
 *               comps, template-paths). No workflow knowledge.
 *   - teamsheet/  team-sheet-specific (tile-builder, format, validate,
 *               merge-overrides, render-pipeline, routes).
 *   - bov/      stub. BOV-specific code lands here when BOV starts.
 *               Mount point reserved below.
 *   - routes/   workflow-agnostic (status, preview).
 *
 * API paths (frozen contract — master-app depends on these):
 *   GET  /status            served by routes/status.js
 *   GET  /preview           served by routes/preview.js (any workflow)
 *   POST /introspect        served by teamsheet/routes/introspect.js
 *   GET  /page-fields       served by teamsheet/routes/page-fields.js
 *   POST /render            served by teamsheet/routes/render.js
 *
 *   /bov/*  reserved for BOV. See mount block below.
 *
 * Run:
 *   cd render-service && node server.js
 *
 * Required env (see .env.example):
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * Optional env:
 *   BRIDGE_URL              (default http://127.0.0.1:3000)
 *   PORT                    (default 8765)
 *   INDESIGN_REPO_ROOT      (default: parent of this directory)
 *   TEMPLATE_MANIFEST_DIR   (default: <repo>/template-manifests)
 *   TEMPLATES_DIR           (default: <repo>/../indesign-templates)
 *   SERVICE_TOKEN           (default: unset = no auth required)
 */

import express from "express";
import config from "./config.js";
import { authMiddleware } from "./core/auth.js";

import statusRouter from "./routes/status.js";
import previewRouter from "./routes/preview.js";
import teamsheetIntrospectRouter from "./teamsheet/routes/introspect.js";
import teamsheetPageFieldsRouter from "./teamsheet/routes/page-fields.js";
import teamsheetRenderRouter from "./teamsheet/routes/render.js";
import bovRouter from "./bov/index.js";

const app = express();
app.disable("x-powered-by");

// Generous limit for render bodies (comp_ids + page_overrides is tiny
// today, but page_overrides could grow with marketing copy).
app.use(express.json({ limit: "1mb" }));

// Auth seam — no-op when SERVICE_TOKEN is unset (local-dev default).
app.use(authMiddleware);

// Workflow-agnostic routes (flat paths)
app.use(statusRouter);
app.use(previewRouter);

// Team-sheet routes (kept at flat paths — master-app's live contract)
app.use(teamsheetIntrospectRouter);
app.use(teamsheetPageFieldsRouter);
app.use(teamsheetRenderRouter);

// BOV routes — mounted at /bov
app.use("/bov", bovRouter);

// Fallback for unmatched routes — JSON 404 instead of HTML.
app.use((req, res) => {
    res.status(404).json({ error: `not found: ${req.method} ${req.path}` });
});

// Express error handler — JSON instead of the default HTML stack.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error("[render-service] unhandled error:", err);
    res.status(500).json({ error: "internal error", detail: err.message });
});

app.listen(config.port, "127.0.0.1", () => {
    console.log(`[render-service] listening on http://127.0.0.1:${config.port}`);
    console.log(`[render-service] bridge url:       ${config.bridgeUrl}`);
    console.log(`[render-service] repo root:        ${config.repoRoot}`);
    console.log(`[render-service] manifest dir:     ${config.manifestDir}`);
    console.log(`[render-service] templates dir:    ${config.templatesDir}`);
    console.log(`[render-service] output dir:       ${config.outputDir}`);
    console.log(
        `[render-service] auth:             ${config.serviceToken ? "ENABLED (Bearer SERVICE_TOKEN)" : "DISABLED"}`
    );
});
