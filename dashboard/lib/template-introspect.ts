/**
 * Template introspection: query the bridge for runtime facts about a
 * template that aren't recorded in the manifest. v1 only resolves
 * tile_count by counting `tile_N_address` frames (the canonical
 * existence check — first required tile_field in the manifest).
 *
 * The introspection happens once per template per dashboard process.
 * Result is cached in-memory until the process restarts. A force-
 * refresh option is exposed for development.
 *
 * The bridge open uses OpenOptions.openCopy so the original template
 * file is never bound to a Document handle, never modified, and the
 * close-after-introspect actually decrements app.documents.length
 * (see dashboard/lib/render-script.mjs header for why this matters).
 */

import path from "node:path";
import { promises as fs } from "node:fs";

const BRIDGE_URL = "http://127.0.0.1:3000";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");

const cache = new Map<string, { tileCount: number; templatePath: string }>();

interface BridgeIntrospectResult {
    ok: boolean;
    error?: string;
    tileCount?: number;
    sampleFrames?: string[];
}

function buildIntrospectCode(templatePath: string): string {
    const lit = JSON.stringify;
    // Probe up to 100 tiles; break on the first miss (tile numbering must be
    // contiguous from 1). Returns the count plus a small sample of the names
    // we actually saw, useful for debugging if a manifest's frame_pattern
    // doesn't match the template.
    return `
        const { SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;
        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('no doc after open');

            let count = 0;
            const sample = [];
            for (let n = 1; n <= 100; n++) {
                const name = 'tile_' + n + '_address';
                const f = doc.textFrames.itemByName(name);
                if (f.isValid) {
                    count++;
                    if (sample.length < 3) sample.push(name);
                } else {
                    break;
                }
            }
            result = { ok: true, tileCount: count, sampleFrames: sample };
        } catch (e) {
            result = { ok: false, error: e.message || String(e) };
        }
        if (doc) {
            try { await doc.close(SaveOptions.no); } catch (e) { /* swallow */ }
        }
        return result;
    `;
}

export interface TemplateIntrospection {
    tileCount: number;
    templatePath: string;
}

export interface IntrospectOptions {
    /** Skip cache and re-query the bridge. */
    force?: boolean;
}

/**
 * Resolve runtime info for a template. The caller passes the manifest
 * entry (id + file relative to repo root); we resolve to absolute,
 * verify the file exists, then query the bridge for tile_count.
 *
 * Throws if the bridge is unreachable, the template is missing, or
 * the template has no `tile_1_address` frame (which would mean the
 * manifest pattern doesn't match the .indd).
 */
export async function getTemplateIntrospection(
    templateId: string,
    fileRelative: string,
    opts: IntrospectOptions = {}
): Promise<TemplateIntrospection> {
    const cached = cache.get(templateId);
    if (cached && !opts.force) return cached;

    const templatePath = path.resolve(REPO_ROOT, fileRelative);

    try {
        await fs.access(templatePath);
    } catch {
        throw new Error(`template file not found: ${templatePath}`);
    }

    const code = buildIntrospectCode(templatePath);

    let res: Response;
    try {
        res = await fetch(`${BRIDGE_URL}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
            cache: "no-store",
        });
    } catch (e) {
        throw new Error(
            `bridge unreachable for introspection (${(e as Error).message}). Start it with: cd bridge && node server.js`
        );
    }

    const body = (await res.json()) as { result?: BridgeIntrospectResult; error?: string };
    if (!res.ok) {
        throw new Error(`bridge returned ${res.status}: ${body.error ?? "unknown"}`);
    }

    const result = body.result;
    if (!result || !result.ok) {
        throw new Error(
            `introspect failed for ${templateId}: ${result?.error ?? "unknown"}`
        );
    }

    if (typeof result.tileCount !== "number" || result.tileCount === 0) {
        throw new Error(
            `template ${templateId} has no tile_1_address frame — manifest may not match the .indd`
        );
    }

    const introspection: TemplateIntrospection = {
        tileCount: result.tileCount,
        templatePath,
    };
    cache.set(templateId, introspection);
    return introspection;
}

/** Drop the cache entry for one template (or all when no id given). */
export function clearIntrospectionCache(templateId?: string): void {
    if (templateId === undefined) cache.clear();
    else cache.delete(templateId);
}
