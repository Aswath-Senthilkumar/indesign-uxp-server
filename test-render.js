#!/usr/bin/env node
/**
 * Stage 3.4 / 3.7 render script.
 *
 * Reads mock-data/comps.json, populates N tiles (1..N) of
 * templates/template-v2-test.indd, and exports one PDF.
 *
 * Stage 3.7 change vs 3.4: the entire populate-and-export sequence is
 * now sent as a single /execute call rather than one POST per
 * operation. This trims HTTP+WebSocket round-trip overhead and lets the
 * plugin batch all DOM mutations under a single new Function(...)
 * compile. The substrate sees one undo step covering the whole render
 * (per the bridge's serial-queue invariant), which also matches our
 * "render is atomic from the user's POV" intent.
 *
 * Usage:
 *   node test-render.js                    # first 6 comps -> tiles 1..6
 *   node test-render.js --id mock-3        # one tile (tile_1 = mock-3)
 *   node test-render.js --ids mock-2,mock-7  # N tiles in given order
 *
 * Pre-flight: comp + image existence + bridge connection are checked
 * locally before the bridge call.
 *
 * Note on path safety: the bridge's POST /execute endpoint forwards
 * code strings to the plugin verbatim and does NOT run the path
 * validator added in Stage 1.5. INDESIGN_ALLOWED_ROOTS does not gate
 * this script. We resolve to absolute and pre-check existence as
 * defense-in-depth, but the only true boundary is InDesign's
 * process-level file permissions.
 */

import { readFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = 'http://127.0.0.1:3000';
const TEMPLATE_NAME = 'template-v2-test.indd';
const OUTPUT_PDF_REL = 'output/test-render.pdf';
const COMPS_PATH_REL = 'mock-data/comps.json';
const IMAGES_DIR_REL = 'mock-data/images';
const MAX_TILES = 6;

function parseArgs(argv) {
    const out = { id: null, ids: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--id') out.id = argv[++i];
        else if (argv[i] === '--ids') out.ids = argv[++i];
    }
    return out;
}

async function bridgeStatus() {
    const r = await fetch(`${BRIDGE_URL}/status`);
    if (!r.ok) throw new Error(`bridge /status returned ${r.status}`);
    return r.json();
}

async function execute(code) {
    const r = await fetch(`${BRIDGE_URL}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
    });
    const body = await r.json();
    if (!r.ok) {
        const err = new Error(`bridge ${r.status}: ${body.error || JSON.stringify(body)}`);
        err.httpStatus = r.status;
        throw err;
    }
    return body.result;
}

function formatSfAc(building_sf, land_area) {
    const sf = building_sf.toLocaleString('en-US');
    const ac = land_area.toFixed(2);
    return `±${sf} SF | ±${ac} AC`;
}

const lit = (s) => JSON.stringify(s);

function selectComps(comps, args) {
    if (args.ids) {
        const wanted = args.ids.split(',').map(s => s.trim()).filter(Boolean);
        return wanted.map(id => {
            const c = comps.find(x => x.id === id);
            if (!c) throw new Error(`no comp with id="${id}" in comps.json`);
            return c;
        });
    }
    if (args.id) {
        const c = comps.find(x => x.id === args.id);
        if (!c) throw new Error(`no comp with id="${args.id}" in comps.json`);
        return [c];
    }
    return comps.slice(0, MAX_TILES);
}

async function main() {
    const args = parseArgs(process.argv);

    // === pre-flight ===
    const compsPath = resolve(__dirname, COMPS_PATH_REL);
    let comps;
    try {
        comps = JSON.parse(readFileSync(compsPath, 'utf8'));
    } catch (e) {
        throw new Error(`could not read ${compsPath}: ${e.message}`);
    }
    if (!Array.isArray(comps) || comps.length === 0) {
        throw new Error(`${compsPath} has no entries`);
    }

    let selected = selectComps(comps, args);
    if (selected.length === 0) throw new Error('no comps selected');
    if (selected.length > MAX_TILES) {
        console.warn(`warning: ${selected.length} comps requested, only first ${MAX_TILES} will be rendered (template has 6 tiles)`);
        selected = selected.slice(0, MAX_TILES);
    }

    // Build per-tile data with absolute image paths and pre-formatted strings.
    const tiles = selected.map((comp, i) => {
        const image = resolve(__dirname, IMAGES_DIR_REL, comp.image_filename);
        let imgStat;
        try { imgStat = statSync(image); }
        catch { throw new Error(`image not found for ${comp.id}: ${image}`); }
        if (imgStat.size < 10 * 1024) throw new Error(`image suspiciously small (${imgStat.size} B): ${image}`);

        return {
            n: i + 1,
            id: comp.id,
            address: comp.address,
            city_state: `${comp.city}, ${comp.state}`,
            sf_ac: formatSfAc(comp.building_sf, comp.land_area),
            image,
            imageSizeKB: imgStat.size / 1024,
        };
    });

    const outputPdf = resolve(__dirname, OUTPUT_PDF_REL);
    mkdirSync(dirname(outputPdf), { recursive: true });

    const status = await bridgeStatus();
    if (!status.connected) throw new Error('bridge says plugin not connected — open InDesign + Bridge Panel');

    // === log selection ===
    console.log(`Bridge:   ${BRIDGE_URL}  connected=${status.connected}`);
    console.log(`Output:   ${outputPdf}`);
    console.log(`Tiles (${tiles.length}):`);
    for (const t of tiles) {
        console.log(`  tile_${t.n}  ${t.id}  ${t.address}, ${t.city_state}  ${t.sf_ac}  (${t.imageSizeKB.toFixed(0)} KB)`);
    }
    console.log('');

    // Tiles serialized into the in-plugin code as a JS literal.
    // We strip caller-side metadata (id, imageSizeKB) since the plugin doesn't need them.
    const pluginTiles = tiles.map(t => ({
        n: t.n,
        address: t.address,
        city_state: t.city_state,
        sf_ac: t.sf_ac,
        image: t.image,
    }));

    const code = `
        const { FitOptions, ExportFormat } = require('indesign');
        const doc = app.activeDocument;
        if (!doc) return { ok: false, error: 'no active document' };
        if (doc.name !== ${lit(TEMPLATE_NAME)}) {
            return { ok: false, error: 'wrong active document: ' + doc.name };
        }

        const tiles = ${JSON.stringify(pluginTiles)};
        const t0 = Date.now();
        const tileTimes = [];

        for (const t of tiles) {
            const tStart = Date.now();
            const prefix = 'tile_' + t.n + '_';

            const fa = doc.textFrames.itemByName(prefix + 'address');
            if (!fa.isValid) return { ok: false, error: prefix + 'address not found' };
            fa.contents = t.address;

            const fc = doc.textFrames.itemByName(prefix + 'city_state');
            if (!fc.isValid) return { ok: false, error: prefix + 'city_state not found' };
            fc.contents = t.city_state;

            const fs = doc.textFrames.itemByName(prefix + 'sf_ac');
            if (!fs.isValid) return { ok: false, error: prefix + 'sf_ac not found' };
            fs.contents = t.sf_ac;

            const rect = doc.rectangles.itemByName(prefix + 'photo');
            if (!rect.isValid) return { ok: false, error: prefix + 'photo not found' };
            try { rect.place(t.image); }
            catch (e) { return { ok: false, error: 'place failed for tile ' + t.n + ': ' + (e.message || String(e)) }; }
            try { rect.fit(FitOptions.fillProportionally); }
            catch (e) { return { ok: false, error: 'fit failed for tile ' + t.n + ': ' + (e.message || String(e)) }; }

            tileTimes.push({ n: t.n, ms: Date.now() - tStart });
        }

        const populateMs = Date.now() - t0;
        const exportStart = Date.now();
        try {
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
        } catch (e) {
            return { ok: false, error: 'export failed: ' + (e.message || String(e)) };
        }
        const exportMs = Date.now() - exportStart;

        return {
            ok: true,
            populateMs,
            exportMs,
            totalMs: Date.now() - t0,
            tileTimes
        };
    `;

    const callStart = Date.now();
    const result = await execute(code);
    const wallMs = Date.now() - callStart;

    if (!result || !result.ok) {
        throw new Error(result?.error || 'render returned no result');
    }

    let pdfStat;
    try { pdfStat = statSync(outputPdf); }
    catch { throw new Error(`PDF not produced at ${outputPdf}`); }

    // === report ===
    console.log('Per-tile (in plugin):');
    for (const t of result.tileTimes) {
        console.log(`  tile_${t.n}: ${t.ms} ms`);
    }
    const tileSum = result.tileTimes.reduce((a, t) => a + t.ms, 0);
    console.log(`  sum:        ${tileSum} ms`);
    console.log('');
    console.log(`Populate (in plugin):  ${result.populateMs} ms`);
    console.log(`Export   (in plugin):  ${result.exportMs} ms`);
    console.log(`Plugin total:          ${result.totalMs} ms`);
    console.log(`Wall clock (caller):   ${wallMs} ms`);
    console.log(`HTTP+WS overhead:      ${wallMs - result.totalMs} ms`);
    console.log('');
    console.log(`PDF: ${outputPdf}  (${(pdfStat.size / 1024).toFixed(1)} KB)`);
}

main().catch(e => {
    console.error('');
    console.error('RENDER FAILED');
    console.error('  ' + (e.message || String(e)));
    if (e.httpStatus) console.error('  HTTP status: ' + e.httpStatus);
    process.exit(1);
});
