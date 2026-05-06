/**
 * Shared bridge-code builder for the team-sheet render flow.
 *
 * Both `test-render.js` (CLI, repo root) and
 * `dashboard/app/api/render/route.ts` (Next.js API route) import from
 * this file so the InDesign-side logic stays in one place. Plain ESM
 * (.mjs) so the CLI can import it directly without TypeScript.
 *
 * Per-render isolation strategy: `OpenOptions.openCopy`.
 *
 *   The original `templates/template-v2-test.indd` is never opened
 *   directly. Each call to `app.open(template, true, OpenOptions.openCopy)`
 *   makes InDesign load the file content into a fresh untitled
 *   document (e.g. `Untitled-7`) with no file backing — its
 *   `fullName` is unreadable and `saved` is false. The original disk
 *   file is never locked, never mutated.
 *
 *   We considered an on-disk working-copy variant
 *   (fs.copyFile -> open -> populate -> close -> fs.unlink) but
 *   InDesign 2026 + UXP exhibits a Document.close() limitation: close
 *   on a doc opened from a real on-disk path is a no-op (returns
 *   undefined, no error, doc stays in app.documents, file lock
 *   stays held). Confirmed across multiple probe scenarios. close
 *   works correctly on openCopy/Untitled docs because they have no
 *   on-disk identity — there is no file lock to release and the
 *   doc handle is fully managed by InDesign in memory.
 *
 *   Net result is what the original spec asked for, just in-memory
 *   instead of on-disk: original immutable, per-render isolation,
 *   working copy created and disposed cleanly per render, no orphans.
 *
 * Returns `{ ok: true, populateMs, exportMs, totalMs, tileTimes }` on
 * success or `{ ok: false, error }` on any failure path. `closeWarning`
 * may be set on either if cleanup-close threw.
 */

const lit = (s) => JSON.stringify(s);

/**
 * @typedef {{ n: number, address: string, city_state: string, sf_ac: string, image: string }} BridgeTile
 */

/**
 * @typedef {{ frame: string, value: string }} PageOverride
 */

/**
 * @param {string} templatePath          absolute path to the read-only source template
 * @param {string} outputPdf             absolute path the plugin should export the PDF to
 * @param {BridgeTile[]} tiles           pre-formatted per-tile data
 * @param {PageOverride[]} [pageOverrides=[]]
 *   Page-level frame overrides. For each entry, the bridge code looks up
 *   the named frame on the working copy and sets its `.contents` to
 *   `value`. Frames that don't exist on the document are skipped silently
 *   and reported in `result.skippedOverrides` so the caller can surface
 *   that information if useful. Empty `value` is allowed and is applied
 *   as-is (becomes an empty frame).
 * @returns {string}  JS source the bridge will evaluate inside the plugin
 */
export function buildBridgeCode(templatePath, outputPdf, tiles, pageOverrides = []) {
    return `
        const { FitOptions, ExportFormat, SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');

        // Suppress the missing-font / missing-link modal. Without this the
        // open call lands in a wedged "headless" state on a fresh InDesign
        // session and no window is created.
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

        const tiles = ${JSON.stringify(tiles)};
        const pageOverrides = ${JSON.stringify(pageOverrides)};
        const t0 = Date.now();
        const tileTimes = [];
        const appliedOverrides = [];
        const skippedOverrides = [];

        let doc;
        let result;
        try {
            // openCopy = load the file content as a fresh Untitled-N doc.
            // The original at templatePath is never bound to a Document
            // handle, so the file lock stays in the OS's hands and the
            // disk bytes are never written to.
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) {
                doc = app.activeDocument; // belt + braces
            }
            if (!doc) {
                throw new Error('app.open returned no document');
            }

            for (const t of tiles) {
                const tStart = Date.now();
                const prefix = 'tile_' + t.n + '_';

                const fa = doc.textFrames.itemByName(prefix + 'address');
                if (!fa.isValid) throw new Error(prefix + 'address not found');
                fa.contents = t.address;

                const fc = doc.textFrames.itemByName(prefix + 'city_state');
                if (!fc.isValid) throw new Error(prefix + 'city_state not found');
                fc.contents = t.city_state;

                const fs = doc.textFrames.itemByName(prefix + 'sf_ac');
                if (!fs.isValid) throw new Error(prefix + 'sf_ac not found');
                fs.contents = t.sf_ac;

                const rect = doc.rectangles.itemByName(prefix + 'photo');
                if (!rect.isValid) throw new Error(prefix + 'photo not found');
                try { rect.place(t.image); }
                catch (e) { throw new Error('place failed for tile ' + t.n + ': ' + (e.message || String(e))); }
                try { rect.fit(FitOptions.fillProportionally); }
                catch (e) { throw new Error('fit failed for tile ' + t.n + ': ' + (e.message || String(e))); }

                tileTimes.push({ n: t.n, ms: Date.now() - tStart });
            }

            // Apply page-level overrides AFTER tile populate. Each override
            // is a (frame, value) pair. Skipped frames don't fail the render
            // — a missing page_title (e.g.) is a soft signal.
            //
            // Font preservation: InDesign's textFrame.contents setter
            // already preserves the first character's formatting onto the
            // new text. An earlier attempt that captured (appliedFont,
            // pointSize, fontStyle, leading, tracking, ...) from the first
            // character and re-applied across the new range collapsed the
            // page_title to the first character's bolder weight, ignoring
            // the paragraph style's intended typography. The simple
            // .contents assignment matches the template's font correctly,
            // so we keep it. If a future template needs deeper preservation
            // (e.g., per-paragraph style retention) we'll handle it as a
            // targeted special case.
            for (const ov of pageOverrides) {
                const f = doc.textFrames.itemByName(ov.frame);
                if (f.isValid) {
                    f.contents = ov.value;
                    appliedOverrides.push(ov.frame);
                } else {
                    skippedOverrides.push(ov.frame);
                }
            }

            const populateMs = Date.now() - t0;
            const exportStart = Date.now();
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            const exportMs = Date.now() - exportStart;

            result = {
                ok: true,
                populateMs,
                exportMs,
                totalMs: Date.now() - t0,
                tileTimes,
                appliedOverrides,
                skippedOverrides
            };
        } catch (e) {
            result = { ok: false, error: e.message || String(e) };
        }

        // Always close. This works for openCopy docs (verified) and
        // discards in-memory mutations. Errors here are non-fatal —
        // surfaced as closeWarning so we don't lose visibility.
        let closeError = null;
        if (doc) {
            try {
                await doc.close(SaveOptions.no);
            } catch (e) {
                closeError = e && e.message ? e.message : String(e);
            }
        }
        if (closeError && result) {
            result.closeWarning = closeError;
        }

        return result;
    `;
}
