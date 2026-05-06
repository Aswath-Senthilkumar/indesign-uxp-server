/**
 * Reads `templates/manifest.json` (at the repo root) and exposes the
 * parsed entries to server components and API routes. Cached at module
 * load — manifest changes require a dev-server restart, which is fine
 * for v1.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "templates", "manifest.json");

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

export interface TemplateManifestEntry {
    id: string;
    label: string;
    file: string;
    tile_fields: TileField[];
    page_fields: PageField[];
    static_frames_note?: string;
}

let cache: TemplateManifestEntry[] | null = null;

export async function loadManifest(): Promise<TemplateManifestEntry[]> {
    if (cache) return cache;
    const raw = await fs.readFile(MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(raw) as { templates?: TemplateManifestEntry[] };
    if (!parsed.templates || !Array.isArray(parsed.templates)) {
        throw new Error(
            `manifest at ${MANIFEST_PATH} is missing a "templates" array`
        );
    }
    cache = parsed.templates;
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
