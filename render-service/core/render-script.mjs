/**
 * Canonical bridge-code builder for the team-sheet render flow.
 *
 * Phase 1 move: this file was previously at
 *   dashboard/lib/render-script.mjs
 * and was imported by both the dashboard's /api/render route and
 * test-render.js at the repo root. Phase 1 extracted the render
 * pipeline into a standalone HTTP service; this file moved with it.
 * The dashboard render route is now a thin proxy and no longer
 * imports this file. test-render.js imports it from this new path.
 *
 * Per-render isolation strategy: `OpenOptions.openCopy`.
 *
 *   The original .indd is never opened directly. Each call to
 *   `app.open(template, true, OpenOptions.openCopy)` makes InDesign
 *   load the file content into a fresh untitled document with no file
 *   backing — its `fullName` is unreadable and `saved` is false. The
 *   original disk file is never locked, never mutated.
 *
 *   We considered an on-disk working-copy variant
 *   (fs.copyFile -> open -> populate -> close -> fs.unlink) but
 *   InDesign 2026 + UXP exhibits a Document.close() limitation: close
 *   on a doc opened from a real on-disk path is a no-op. close works
 *   correctly on openCopy/Untitled docs because they have no on-disk
 *   identity.
 *
 * Field-agnostic tile contract. Each tile carries a pre-built array of
 * `{ key, type, value }` records (one per declared tile field in the
 * manifest). The bridge dispatches on `type`:
 *
 *   - `text`  -> textFrame.itemByName(prefix + key).contents = value
 *   - `image` -> rectangle.itemByName(prefix + key).place(value) +
 *               fit, OR clear + 20% grey fill when value is empty
 *
 * Adding a new tile field to a template = adding it to the manifest's
 * `tile_fields[]` and mapping its name to a value in the render
 * pipeline's `resolveTileFieldValue()`. The bridge code itself doesn't
 * change.
 *
 * Multi-page page-override fan-out: each page override updates EVERY
 * text frame matching the given name on the document, not just the
 * first. Verified against the 18-tile 2-page template where
 * `page_title` and `page_tagline` each appear twice (once per page).
 */

const lit = (s) => JSON.stringify(s);

/**
 * @typedef {{ key: string, type: 'text' | 'image', value: string }} BridgeTileField
 */

/**
 * @typedef {{ n: number, fields: BridgeTileField[] }} BridgeTile
 *   For `image` fields, `value` is either an absolute filesystem path
 *   to the placed photo or the empty string. Empty string clears the
 *   rect's placeholder graphic and fills with 20% black so the slot
 *   reads as an intentional grey placeholder.
 *
 *   For `text` fields, `value` is set as-is. Empty string blanks the
 *   frame (e.g. status with null DB value).
 */

/**
 * @typedef {{ frame: string, value: string }} PageOverride
 */

/**
 * @param {string} templatePath          absolute path to the read-only source template
 * @param {string} outputPdf             absolute path the plugin should export the PDF to
 * @param {BridgeTile[]} tiles           pre-formatted per-tile data
 * @param {PageOverride[]} [pageOverrides=[]]
 *   Each override is applied to EVERY matching text frame in the
 *   document. Multi-page templates can declare a page-level frame
 *   once per page (same name on each page); a single override entry
 *   updates all of them. Frames that don't exist anywhere are
 *   reported in `result.skippedOverrides`. `result.appliedOverrides`
 *   carries `{ frame, count }` so the caller can see fan-out.
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
        const tilesWithoutImage = [];
        const appliedOverrides = [];
        const skippedOverrides = [];

        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) {
                doc = app.activeDocument;
            }
            if (!doc) {
                throw new Error('app.open returned no document');
            }

            for (const t of tiles) {
                const tStart = Date.now();
                const prefix = 'tile_' + t.n + '_';
                let imageWasBlank = false;

                for (const f of t.fields) {
                    const fullName = prefix + f.key;
                    if (f.type === 'text') {
                        const tf = doc.textFrames.itemByName(fullName);
                        if (!tf.isValid) throw new Error(fullName + ' not found');
                        tf.contents = f.value;
                    } else if (f.type === 'image') {
                        const rect = doc.rectangles.itemByName(fullName);
                        if (!rect.isValid) throw new Error(fullName + ' not found');
                        if (f.value) {
                            try { rect.place(f.value); }
                            catch (e) { throw new Error('place failed for tile ' + t.n + ' ' + f.key + ': ' + (e.message || String(e))); }
                            try { rect.fit(FitOptions.fillProportionally); }
                            catch (e) { throw new Error('fit failed for tile ' + t.n + ' ' + f.key + ': ' + (e.message || String(e))); }
                        } else {
                            // No usable image. Remove the placeholder graphic
                            // and fill with 20% black so the slot reads as an
                            // intentional grey block. Soft-fail: if either
                            // step can't run, the render still completes.
                            try {
                                if (rect.graphics.length > 0) {
                                    rect.graphics.everyItem().remove();
                                }
                            } catch (e) { /* non-fatal */ }
                            try {
                                rect.fillColor = doc.swatches.itemByName('Black');
                                rect.fillTint = 20;
                            } catch (e) { /* non-fatal */ }
                            imageWasBlank = true;
                        }
                    } else {
                        throw new Error('unknown field type for tile ' + t.n + ' ' + f.key + ': ' + f.type);
                    }
                }

                if (imageWasBlank) tilesWithoutImage.push(t.n);
                tileTimes.push({ n: t.n, ms: Date.now() - tStart });
            }

            // Apply page-level overrides AFTER tile populate. Fan out to
            // ALL text frames matching the override's frame name, not
            // just the first. Multi-page templates can declare the same
            // frame name on each page (e.g. page_title on both pages 1
            // and 2 of an 18-tile template); every copy receives the
            // override.
            //
            // Font preservation: InDesign's textFrame.contents setter
            // preserves the first character's formatting on each frame.
            // An earlier capture-and-reapply experiment collapsed the
            // typography by overriding paragraph styling; the simple
            // .contents assignment matches the template's intended look.
            const allTextFrames = doc.textFrames.everyItem().getElements();
            for (const ov of pageOverrides) {
                let count = 0;
                for (let i = 0; i < allTextFrames.length; i++) {
                    const tf = allTextFrames[i];
                    if (tf.name === ov.frame) {
                        tf.contents = ov.value;
                        count++;
                    }
                }
                if (count > 0) {
                    appliedOverrides.push({ frame: ov.frame, count });
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
                tilesWithoutImage,
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
