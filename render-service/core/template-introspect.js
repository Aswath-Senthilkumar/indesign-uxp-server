/**
 * Template introspection: query the bridge for runtime facts about a
 * template that aren't recorded in the manifest. v1 only resolves
 * tile_count by counting `tile_N_address` frames (the canonical
 * existence check — first required tile_field in the manifest).
 *
 * Introspection happens once per template per service process. Result
 * is cached in-memory until the process restarts. A force-refresh
 * option is exposed for development.
 *
 * The bridge open uses OpenOptions.openCopy so the original template
 * file is never bound to a Document handle, never modified.
 */

import { promises as fs } from "node:fs";
import { bridgeExecute } from "./bridge-client.js";
import { resolveTemplatePath } from "./template-paths.js";

const cache = new Map();

function buildIntrospectCode(templatePath) {
    const lit = JSON.stringify;
    // Probe up to 100 tiles; break on the first miss (tile numbering
    // must be contiguous from 1). Returns the count plus a small
    // sample of the names we actually saw, useful for debugging if a
    // manifest's frame_pattern doesn't match the template.
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

/**
 * Resolve runtime info for a template.
 *
 * @param {object} manifest  Template manifest entry (id, file, ...).
 *                           `manifest.id` is the cache key; `manifest.file`
 *                           is resolved via core/template-paths.js.
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ tileCount: number, templatePath: string, sampleFrames?: string[] }>}
 */
export async function getTemplateIntrospection(manifest, opts = {}) {
    const templateId = manifest.id;
    const cached = cache.get(templateId);
    if (cached && !opts.force) return cached;

    const templatePath = resolveTemplatePath(manifest);

    try {
        await fs.access(templatePath);
    } catch {
        throw new Error(`template file not found: ${templatePath}`);
    }

    const code = buildIntrospectCode(templatePath);
    const result = await bridgeExecute(code);

    if (!result || result.ok !== true) {
        throw new Error(
            `introspect failed for ${templateId}: ${result?.error ?? "unknown"}`
        );
    }

    if (typeof result.tileCount !== "number" || result.tileCount === 0) {
        throw new Error(
            `template ${templateId} has no tile_1_address frame — manifest may not match the .indd`
        );
    }

    const introspection = {
        tileCount: result.tileCount,
        templatePath,
        sampleFrames: result.sampleFrames,
    };
    cache.set(templateId, introspection);
    return introspection;
}

export function clearIntrospectionCache(templateId) {
    if (templateId === undefined) cache.clear();
    else cache.delete(templateId);
}
