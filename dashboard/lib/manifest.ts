/*
 * Template registry. The dashboard scans every "manifest.json" under
 * `dashboard/templates/<TemplateName>/` and aggregates each entry. To
 * add a new template:
 *
 *   1. Drop a .indd into the repo-root templates directory.
 *   2. Create a sibling folder under dashboard/templates/<TemplateName>/
 *      and put a manifest.json in it with the shape:
 *        { id, label, file, tile_fields, page_fields, static_frames_note? }
 *
 * No code changes required. The new entry is discovered at module load
 * (cached for the dashboard process lifetime) and shows up on the
 * picker.
 *
 * `id` is the URL/state key, must be unique. `file` is the .indd path
 * relative to the repo root (NOT relative to the per-template dir).
 * tile_count is NOT recorded here — resolved at runtime by
 * dashboard/lib/template-introspect.ts via the bridge.
 *
 * Template entries with parse errors are skipped with a server-side
 * console warning rather than failing the whole load.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const TEMPLATES_DIR = path.resolve(process.cwd(), "templates");

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
}

let cache: TemplateManifestEntry[] | null = null;

function isTemplateEntry(v: unknown): v is TemplateManifestEntry {
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

export async function loadManifest(): Promise<TemplateManifestEntry[]> {
    if (cache) return cache;

    let dirEntries: { name: string; isDirectory: () => boolean }[];
    try {
        dirEntries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
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

    const folders = dirEntries
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

    const entries: TemplateManifestEntry[] = [];
    const seenIds = new Set<string>();
    for (const folder of folders) {
        const manifestPath = path.join(TEMPLATES_DIR, folder, "manifest.json");
        let raw: string;
        try {
            raw = await fs.readFile(manifestPath, "utf8");
        } catch (e) {
            const err = e as NodeJS.ErrnoException;
            if (err.code === "ENOENT") {
                console.warn(
                    `[manifest] no manifest.json in dashboard/templates/${folder} — skipping`
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
                `[manifest] dashboard/templates/${folder}/manifest.json is not valid JSON — skipping (${(e as Error).message})`
            );
            continue;
        }

        if (!isTemplateEntry(parsed)) {
            console.warn(
                `[manifest] dashboard/templates/${folder}/manifest.json is missing required fields — skipping`
            );
            continue;
        }

        if (seenIds.has(parsed.id)) {
            console.warn(
                `[manifest] dashboard/templates/${folder} declares id="${parsed.id}" which was already registered — skipping duplicate`
            );
            continue;
        }
        seenIds.add(parsed.id);
        entries.push(parsed);
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

export function clearManifestCache(): void {
    cache = null;
}
