/**
 * Single point of truth for resolving a template manifest entry to an
 * absolute .indd path on disk.
 *
 * The manifest's `file` field is the .indd filename only (no
 * directory) — for example `"6_Tile_Defaults.indd"`. The actual file
 * lives under `TEMPLATES_DIR` (configurable env, defaults to
 * `<repo>/../indesign-templates/` per `config.js`).
 *
 * Keeping this helper centralized means:
 *   - There's only one place that knows how `file` gets resolved.
 *   - Changing the storage layout (e.g. `TEMPLATES_DIR/<workflow>/<file>`
 *     later) is a one-line edit.
 *   - Callers (render pipeline, preview route, page-fields route)
 *     never `path.join` the templates dir themselves.
 */

import path from "node:path";
import config from "../config.js";

/**
 * @param {object} manifest  Template manifest entry (see core/manifest.js)
 * @returns {string} absolute path to the .indd file
 */
export function resolveTemplatePath(manifest) {
    if (!manifest || typeof manifest.file !== "string" || manifest.file.length === 0) {
        throw new Error(
            "resolveTemplatePath: manifest.file is missing or empty"
        );
    }
    // path.basename strips any accidental directory prefix in the
    // manifest (legacy manifests carried a `templates/` prefix; the
    // current schema is filename-only, but be defensive).
    const filename = path.basename(manifest.file);
    return path.join(config.templatesDir, filename);
}
