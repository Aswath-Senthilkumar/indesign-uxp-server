/*
 * Template registry. The dashboard scans
 *   `dashboard/templates/<workflow>/<TemplateName>/manifest.json`
 * and aggregates each entry. Workflow is path-derived: the first
 * directory level under `dashboard/templates/` IS the workflow id
 * and must match one of the ids declared in `dashboard/lib/workflows.ts`.
 *
 * To add a new template:
 *   1. Drop a .indd into the repo-root `templates/` directory.
 *   2. Create a folder under `dashboard/templates/<workflow>/<TemplateName>/`
 *      and put a manifest.json in it with the shape:
 *        { id, label, file, tile_fields, page_fields, static_frames_note? }
 *      where `id` is unique across ALL workflows and `file` is the .indd
 *      path relative to the repo root (NOT relative to the per-template dir).
 *
 * No code changes required. The new entry is discovered at module load
 * (cached for the dashboard process lifetime) and shows up on the picker
 * once the user picks the corresponding workflow.
 *
 * tile_count is NOT recorded in the manifest — resolved at runtime by
 * dashboard/lib/template-introspect.ts via the bridge.
 *
 * Template entries with parse errors are skipped with a server-side
 * console warning rather than failing the whole load.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { WORKFLOWS, type WorkflowId, isWorkflowId } from "./workflows";

// Manifests moved out of dashboard/ during the 2026-05-16 restructure.
// They now live at <repo>/template-manifests/<workflow>/<TemplateName>/
// (committed). The dashboard is a Next.js app run from dashboard/,
// so process.cwd() = dashboard/; one level up is the repo root.
const TEMPLATES_DIR = path.resolve(process.cwd(), "..", "template-manifests");

export interface TileField {
    field: string;
    frame_pattern: string;
    type: "text" | "image";
    required: boolean;
    format?: string;
    fit?: string;
}

export interface PageField {
    field: string;
    frame: string;
    type: "text";
    editable: boolean;
}

/**
 * Per-template grid hint. Drives the desktop column count of the
 * tile-arrangement grid in /build/edit so the dashboard can mirror the
 * actual InDesign layout (e.g. a 2-column × 3-row sheet renders as a
 * 2-column drag grid). Optional — when absent, the edit page falls
 * back to a generic count-based heuristic.
 */
export interface GridHint {
    cols: number;
}

export interface TemplateManifestEntry {
    id: string;
    label: string;
    file: string;
    tile_fields: TileField[];
    page_fields: PageField[];
    grid?: GridHint;
    static_frames_note?: string;
    /**
     * Path-derived workflow id (the parent folder name under
     * `dashboard/templates/`). Not stored in the manifest.json itself —
     * the scanner fills this in from the directory layout.
     */
    workflow: WorkflowId;
}

interface RawTemplateEntry {
    id: string;
    label: string;
    file: string;
    tile_fields: TileField[];
    page_fields: PageField[];
    grid?: GridHint;
    static_frames_note?: string;
}

let cache: TemplateManifestEntry[] | null = null;

function isRawTemplateEntry(v: unknown): v is RawTemplateEntry {
    if (typeof v !== "object" || v === null) return false;
    const o = v as Record<string, unknown>;
    return (
        typeof o.id === "string" &&
        typeof o.label === "string" &&
        typeof o.file === "string" &&
        Array.isArray(o.tile_fields) &&
        Array.isArray(o.page_fields)
    );
}

async function listDirs(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

export async function loadManifest(): Promise<TemplateManifestEntry[]> {
    if (cache) return cache;

    let workflowDirs: string[];
    try {
        workflowDirs = await listDirs(TEMPLATES_DIR);
    } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
            console.warn(
                `[manifest] no templates directory at ${TEMPLATES_DIR} — manifest is empty`
            );
            cache = [];
            return cache;
        }
        throw e;
    }

    const entries: TemplateManifestEntry[] = [];
    const seenIds = new Set<string>();

    for (const workflowFolder of workflowDirs) {
        if (!isWorkflowId(workflowFolder)) {
            console.warn(
                `[manifest] dashboard/templates/${workflowFolder} is not a recognized workflow id (known: ${Object.keys(WORKFLOWS).join(", ")}) — skipping its contents`
            );
            continue;
        }
        const workflow: WorkflowId = workflowFolder;
        const workflowDirPath = path.join(TEMPLATES_DIR, workflowFolder);

        let templateFolders: string[];
        try {
            templateFolders = await listDirs(workflowDirPath);
        } catch (e) {
            console.warn(
                `[manifest] couldn't read dashboard/templates/${workflowFolder}/: ${(e as Error).message}`
            );
            continue;
        }

        for (const tplFolder of templateFolders) {
            const manifestPath = path.join(
                workflowDirPath,
                tplFolder,
                "manifest.json"
            );
            let raw: string;
            try {
                raw = await fs.readFile(manifestPath, "utf8");
            } catch (e) {
                const err = e as NodeJS.ErrnoException;
                if (err.code === "ENOENT") {
                    console.warn(
                        `[manifest] no manifest.json in dashboard/templates/${workflowFolder}/${tplFolder} — skipping`
                    );
                    continue;
                }
                throw e;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                console.warn(
                    `[manifest] dashboard/templates/${workflowFolder}/${tplFolder}/manifest.json is not valid JSON — skipping (${(e as Error).message})`
                );
                continue;
            }

            if (!isRawTemplateEntry(parsed)) {
                console.warn(
                    `[manifest] dashboard/templates/${workflowFolder}/${tplFolder}/manifest.json is missing required fields — skipping`
                );
                continue;
            }

            if (seenIds.has(parsed.id)) {
                console.warn(
                    `[manifest] dashboard/templates/${workflowFolder}/${tplFolder} declares id="${parsed.id}" which was already registered — skipping duplicate`
                );
                continue;
            }
            seenIds.add(parsed.id);
            entries.push({ ...parsed, workflow });
        }
    }

    cache = entries;
    return cache;
}

export async function getTemplate(
    id: string
): Promise<TemplateManifestEntry | null> {
    const all = await loadManifest();
    return all.find((t) => t.id === id) ?? null;
}

export async function getTemplatesForWorkflow(
    workflow: WorkflowId
): Promise<TemplateManifestEntry[]> {
    const all = await loadManifest();
    return all.filter((t) => t.workflow === workflow);
}

export function clearManifestCache(): void {
    cache = null;
}
