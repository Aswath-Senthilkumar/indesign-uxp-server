/**
 * Template registry. Walks
 *   ${config.manifestDir}/<workflow>/<TemplateName>/manifest.json
 * and aggregates each entry. Workflow is path-derived: the first
 * directory level under the manifest dir IS the workflow id.
 *
 * Default `manifestDir` is `<repo>/template-manifests` (per config.js).
 * The .indd files themselves live OUTSIDE the repo, at `TEMPLATES_DIR`
 * (default `<repo>/../indesign-templates/`). The manifest's `file`
 * field is the .indd filename only; resolution to an absolute path
 * goes through `core/template-paths.js`.
 *
 * Cache invalidates on process restart only. Service restart picks up
 * new/edited manifests.
 *
 * Manifest entries with parse errors are skipped with a console warning
 * rather than failing the whole load.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import config from "../config.js";

// Workflow registry. Path segments that aren't in this set are skipped
// with a console warning. Keep in sync with any UI-side workflow
// registry (e.g. master-app's workflow picker).
const WORKFLOW_IDS = new Set(["team-sheets", "bov"]);

let cache = null;

function isRawTemplateEntry(v) {
    if (typeof v !== "object" || v === null) return false;
    return (
        typeof v.id === "string" &&
        typeof v.label === "string" &&
        typeof v.file === "string" &&
        Array.isArray(v.tile_fields) &&
        Array.isArray(v.page_fields)
    );
}

async function listDirs(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
}

export async function loadManifest() {
    if (cache) return cache;

    let workflowDirs;
    try {
        workflowDirs = await listDirs(config.manifestDir);
    } catch (e) {
        if (e.code === "ENOENT") {
            console.warn(
                `[manifest] no templates directory at ${config.manifestDir} — manifest is empty`
            );
            cache = [];
            return cache;
        }
        throw e;
    }

    const entries = [];
    const seenIds = new Set();

    for (const workflowFolder of workflowDirs) {
        if (!WORKFLOW_IDS.has(workflowFolder)) {
            console.warn(
                `[manifest] ${workflowFolder} is not a recognized workflow id (known: ${[...WORKFLOW_IDS].join(", ")}) — skipping its contents`
            );
            continue;
        }
        const workflowDirPath = path.join(config.manifestDir, workflowFolder);

        let templateFolders;
        try {
            templateFolders = await listDirs(workflowDirPath);
        } catch (e) {
            console.warn(
                `[manifest] couldn't read ${workflowDirPath}: ${e.message}`
            );
            continue;
        }

        for (const tplFolder of templateFolders) {
            const manifestPath = path.join(
                workflowDirPath,
                tplFolder,
                "manifest.json"
            );
            let raw;
            try {
                raw = await fs.readFile(manifestPath, "utf8");
            } catch (e) {
                if (e.code === "ENOENT") {
                    console.warn(
                        `[manifest] no manifest.json in ${workflowFolder}/${tplFolder} — skipping`
                    );
                    continue;
                }
                throw e;
            }

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                console.warn(
                    `[manifest] ${workflowFolder}/${tplFolder}/manifest.json is not valid JSON — skipping (${e.message})`
                );
                continue;
            }

            if (!isRawTemplateEntry(parsed)) {
                console.warn(
                    `[manifest] ${workflowFolder}/${tplFolder}/manifest.json is missing required fields — skipping`
                );
                continue;
            }

            if (seenIds.has(parsed.id)) {
                console.warn(
                    `[manifest] ${workflowFolder}/${tplFolder} declares id="${parsed.id}" which was already registered — skipping duplicate`
                );
                continue;
            }
            seenIds.add(parsed.id);
            entries.push({ ...parsed, workflow: workflowFolder });
        }
    }

    cache = entries;
    return cache;
}

export async function getTemplate(id) {
    const all = await loadManifest();
    return all.find((t) => t.id === id) ?? null;
}

export function clearManifestCache() {
    cache = null;
}
