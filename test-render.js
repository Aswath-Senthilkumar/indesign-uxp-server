#!/usr/bin/env node
/**
 * Stage 3.4 / 3.7 / 4.x render script.
 *
 * Reads mock-data/comps.json, populates N tiles (1..N) of the
 * `templates/template-v2-test.indd` template, and exports one PDF to
 * `output/test-render.pdf`.
 *
 * Stage 3.7: populate+export atomic via a single /execute call (the
 * bridge-side code is built by dashboard/lib/render-script.mjs, shared
 * with the dashboard's API route).
 *
 * Stage 4.x: the original template is treated as immutable. Rather
 * than copying the file to disk, the bridge code uses
 * `OpenOptions.openCopy` to load the file content into a fresh
 * untitled InDesign document — the original disk file is never opened
 * or locked. After populate + export, the untitled doc is closed
 * (which actually works for openCopy docs; close on a path-backed doc
 * is a no-op in this UXP / InDesign 2026 build, see
 * dashboard/lib/render-script.mjs for the full investigation notes).
 *
 * Usage:
 *   node test-render.js                       # first 6 comps -> tiles 1..6
 *   node test-render.js --id mock-3           # one tile (tile_1 = mock-3)
 *   node test-render.js --ids mock-2,mock-7   # N tiles in given order
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

import { promises as fs, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBridgeCode } from './dashboard/lib/render-script.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = 'http://127.0.0.1:3000';
const TEMPLATE_REL = 'templates/template-v2-test.indd';
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

    const compsPath = resolve(__dirname, COMPS_PATH_REL);
    const compsRaw = await fs.readFile(compsPath, 'utf8');
    const comps = JSON.parse(compsRaw);
    if (!Array.isArray(comps) || comps.length === 0) {
        throw new Error(`${compsPath} has no entries`);
    }

    let selected = selectComps(comps, args);
    if (selected.length === 0) throw new Error('no comps selected');
    if (selected.length > MAX_TILES) {
        console.warn(`warning: ${selected.length} comps requested, only first ${MAX_TILES} will be rendered`);
        selected = selected.slice(0, MAX_TILES);
    }

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

    const templatePath = resolve(__dirname, TEMPLATE_REL);
    try { await fs.access(templatePath); }
    catch { throw new Error(`template not found: ${templatePath}`); }

    const outputPdf = resolve(__dirname, OUTPUT_PDF_REL);
    await fs.mkdir(dirname(outputPdf), { recursive: true });

    const status = await bridgeStatus();
    if (!status.connected) throw new Error('bridge says plugin not connected — open InDesign + Bridge Panel');

    console.log(`Bridge:        ${BRIDGE_URL}  connected=${status.connected}`);
    console.log(`Template:      ${templatePath}  (read-only, opened via OpenOptions.openCopy)`);
    console.log(`Output PDF:    ${outputPdf}`);
    console.log(`Tiles (${tiles.length}):`);
    for (const t of tiles) {
        console.log(`  tile_${t.n}  ${t.id}  ${t.address}, ${t.city_state}  ${t.sf_ac}  (${t.imageSizeKB.toFixed(0)} KB)`);
    }
    console.log('');

    // Strip caller-side metadata (id, imageSizeKB) from the bridge payload.
    const pluginTiles = tiles.map(t => ({
        n: t.n,
        address: t.address,
        city_state: t.city_state,
        sf_ac: t.sf_ac,
        image: t.image,
    }));

    const callStart = Date.now();
    const result = await execute(buildBridgeCode(templatePath, outputPdf, pluginTiles));
    const wallMs = Date.now() - callStart;

    if (!result || !result.ok) {
        const detail = result?.error || 'render returned no result';
        throw new Error(detail);
    }

    let pdfStat;
    try { pdfStat = statSync(outputPdf); }
    catch { throw new Error(`PDF not produced at ${outputPdf}`); }

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
    if (result.closeWarning) {
        console.log(`Close warning:         ${result.closeWarning}`);
    }
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
