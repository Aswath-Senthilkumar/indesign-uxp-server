/**
 * Centralized configuration for the render service.
 *
 * Loads `.env` (if present) and resolves all env-derived paths/URLs
 * once at boot so the rest of the code reads frozen values. Throws
 * loud at boot on misconfiguration (required env missing, templates
 * dir missing/empty) so failures surface before the first request.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });

function required(name) {
    const v = process.env[name];
    if (!v || v.length === 0) {
        throw new Error(
            `[render-service] missing required env var ${name}. ` +
                `Copy render-service/.env.example to render-service/.env and fill it in, ` +
                `or export ${name} in your shell.`
        );
    }
    return v;
}

function optional(name, fallback) {
    const v = process.env[name];
    return v && v.length > 0 ? v : fallback;
}

// Repo root anchors `output/` (PDF staging). Default: parent of
// `render-service/` (i.e. repo root when launched from `render-service/`).
const repoRoot = path.resolve(
    optional("INDESIGN_REPO_ROOT", path.resolve(__dirname, ".."))
);

// Manifest source dir. Defaults to `<repo>/template-manifests` — the
// in-repo, committed manifests.
const manifestDir = path.resolve(
    optional("TEMPLATE_MANIFEST_DIR", path.join(repoRoot, "template-manifests"))
);

// Templates dir. .indd files live OUTSIDE the repo (they are ~200 MB
// each and exceed GitHub's per-file limit). Default: sibling of the
// repo, `<repo>/../indesign-templates/`. Operator must populate it
// with the .indd files referenced by manifests.
const templatesDir = path.resolve(
    optional("TEMPLATES_DIR", path.join(repoRoot, "..", "indesign-templates"))
);

const outputDir = path.join(repoRoot, "output");
const workingDir = path.join(outputDir, "working");

const port = Number(optional("PORT", "8765"));
if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`[render-service] invalid PORT: ${process.env.PORT}`);
}

// Loud boot-time check: TEMPLATES_DIR must exist and contain at least
// one .indd. A missing or empty directory means the operator forgot to
// drop templates in after deploy / git clone — render would 500 with a
// confusing "template file not found" later. Better to fail at boot
// with a clear, actionable message.
function assertTemplatesDirReady(dir) {
    if (!existsSync(dir)) {
        throw new Error(
            `[render-service] TEMPLATES_DIR does not exist: ${dir}\n` +
                `  Create it and drop the .indd files there, then restart.\n` +
                `  Override the default via the TEMPLATES_DIR env var.`
        );
    }
    if (!statSync(dir).isDirectory()) {
        throw new Error(
            `[render-service] TEMPLATES_DIR is not a directory: ${dir}`
        );
    }
    const indds = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".indd"));
    if (indds.length === 0) {
        throw new Error(
            `[render-service] TEMPLATES_DIR contains no .indd files: ${dir}\n` +
                `  Drop the .indd files referenced by template-manifests/<workflow>/<name>/manifest.json there, then restart.`
        );
    }
}

assertTemplatesDirReady(templatesDir);

const config = Object.freeze({
    port,
    bridgeUrl: optional("BRIDGE_URL", "http://127.0.0.1:3000").replace(/\/+$/, ""),
    serviceToken: optional("SERVICE_TOKEN", "") || null,
    repoRoot,
    manifestDir,
    templatesDir,
    outputDir,
    workingDir,
    supabase: Object.freeze({
        url: required("SUPABASE_URL"),
        anonKey: required("SUPABASE_ANON_KEY"),
    }),
});

export default config;
