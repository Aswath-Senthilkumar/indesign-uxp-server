#!/usr/bin/env node
/**
 * Stage 3.4 — first end-to-end render through Hannah's template.
 *
 * Reads mock-data/comps.json, populates the four named frames in tile 1
 * of templates/template-v2-test.indd, and exports to output/test-render.pdf.
 *
 * Usage:
 *   node test-render.js              # uses comps[0]
 *   node test-render.js --id mock-3  # uses comp with id="mock-3"
 *
 * Pre-flight checks happen locally before any bridge call. The script does
 * NOT close the document at the end — InDesign keeps it open for visual
 * inspection in Stage 3.5.
 *
 * Note on path safety: the bridge's POST /execute endpoint forwards code
 * strings verbatim to the plugin without path validation. The path
 * validator added in Stage 1.5 lives in src/handlers/, which we are not
 * going through. We resolve paths to absolute via path.resolve() and
 * pre-check existence locally — defense in depth, but the only true
 * boundary here is InDesign's process-level file permissions.
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

function parseArgs(argv) {
    const out = { id: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--id') out.id = argv[++i];
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
    if (body.result && typeof body.result === 'object' && body.result.success === false) {
        throw new Error(`plugin returned failure: ${body.result.error || JSON.stringify(body.result)}`);
    }
    return body.result;
}

async function step(name, code) {
    const t0 = Date.now();
    const result = await execute(code);
    const ms = Date.now() - t0;
    console.log(`  [${String(ms).padStart(5)} ms] ${name}`);
    return { result, ms };
}

function formatSfAc(building_sf, land_area) {
    const sf = building_sf.toLocaleString('en-US');
    const ac = land_area.toFixed(2);
    return `±${sf} SF | ±${ac} AC`;
}

// JS literal helper — embed JS-string literal in the code we send to the bridge.
// Using JSON.stringify gives us a properly-quoted JS string literal for any UTF-8 input.
const lit = (s) => JSON.stringify(s);

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

    const comp = args.id
        ? comps.find(c => c.id === args.id)
        : comps[0];
    if (!comp) {
        throw new Error(`no comp with id="${args.id}" in ${compsPath}`);
    }

    const imagePath = resolve(__dirname, IMAGES_DIR_REL, comp.image_filename);
    let imgStat;
    try { imgStat = statSync(imagePath); }
    catch { throw new Error(`image not found: ${imagePath}`); }
    if (imgStat.size < 10 * 1024) throw new Error(`image suspiciously small (${imgStat.size} B): ${imagePath}`);

    const outputPdf = resolve(__dirname, OUTPUT_PDF_REL);
    mkdirSync(dirname(outputPdf), { recursive: true });

    const status = await bridgeStatus();
    if (!status.connected) throw new Error('bridge says plugin not connected — open InDesign + Bridge Panel');

    // === log selection ===
    console.log(`Comp:     ${comp.id}  ${comp.address}, ${comp.city}, ${comp.state}`);
    console.log(`Image:    ${imagePath}  (${(imgStat.size / 1024).toFixed(1)} KB)`);
    console.log(`Output:   ${outputPdf}`);
    console.log(`Bridge:   ${BRIDGE_URL}  connected=${status.connected}`);
    console.log('');

    const tStart = Date.now();

    // === step 1: confirm active document ===
    await step('confirm active document is template-v2-test.indd', `
        const doc = app.activeDocument;
        if (!doc) return { ok: false, error: 'no active document' };
        if (doc.name !== ${lit(TEMPLATE_NAME)}) {
            return { ok: false, error: 'wrong active document: ' + doc.name };
        }
        return { ok: true, name: doc.name };
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'document check failed');
    });

    // === step 2: set tile_1_address ===
    await step(`set tile_1_address = ${JSON.stringify(comp.address)}`, `
        const doc = app.activeDocument;
        const f = doc.textFrames.itemByName('tile_1_address');
        if (!f.isValid) return { ok: false, error: 'tile_1_address not found' };
        f.contents = ${lit(comp.address)};
        return { ok: true };
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'tile_1_address set failed');
    });

    // === step 3: set tile_1_city_state ===
    const cityState = `${comp.city}, ${comp.state}`;
    await step(`set tile_1_city_state = ${JSON.stringify(cityState)}`, `
        const doc = app.activeDocument;
        const f = doc.textFrames.itemByName('tile_1_city_state');
        if (!f.isValid) return { ok: false, error: 'tile_1_city_state not found' };
        f.contents = ${lit(cityState)};
        return { ok: true };
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'tile_1_city_state set failed');
    });

    // === step 4: set tile_1_sf_ac ===
    const sfAc = formatSfAc(comp.building_sf, comp.land_area);
    await step(`set tile_1_sf_ac = ${JSON.stringify(sfAc)}`, `
        const doc = app.activeDocument;
        const f = doc.textFrames.itemByName('tile_1_sf_ac');
        if (!f.isValid) return { ok: false, error: 'tile_1_sf_ac not found' };
        f.contents = ${lit(sfAc)};
        return { ok: true };
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'tile_1_sf_ac set failed');
    });

    // === step 5: place image into tile_1_photo with FILL_PROPORTIONALLY ===
    await step(`place image into tile_1_photo (FILL_PROPORTIONALLY)`, `
        const { FitOptions } = require('indesign');
        const doc = app.activeDocument;
        const r = doc.rectangles.itemByName('tile_1_photo');
        if (!r.isValid) return { ok: false, error: 'tile_1_photo not found' };
        try { r.place(${lit(imagePath)}); }
        catch (e) { return { ok: false, error: 'place failed: ' + (e.message || String(e)) }; }
        try { r.fit(FitOptions.fillProportionally); }
        catch (e) { return { ok: false, error: 'fit failed: ' + (e.message || String(e)) }; }
        return { ok: true };
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'place/fit failed');
    });

    // === step 6: export PDF ===
    await step(`export PDF -> ${OUTPUT_PDF_REL}`, `
        const { ExportFormat } = require('indesign');
        const doc = app.activeDocument;
        try {
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            return { ok: true };
        } catch (e) {
            return { ok: false, error: 'export failed: ' + (e.message || String(e)) };
        }
    `).then(({ result }) => {
        if (!result || !result.ok) throw new Error(result?.error || 'export failed');
    });

    // === verify PDF on disk ===
    let pdfStat;
    try { pdfStat = statSync(outputPdf); }
    catch { throw new Error(`PDF not produced at ${outputPdf}`); }

    const totalMs = Date.now() - tStart;
    console.log('');
    console.log(`PDF:      ${outputPdf}  (${(pdfStat.size / 1024).toFixed(1)} KB)`);
    console.log(`Total:    ${totalMs} ms`);
}

main().catch(e => {
    console.error('');
    console.error('RENDER FAILED');
    console.error('  ' + (e.message || String(e)));
    if (e.httpStatus) console.error('  HTTP status: ' + e.httpStatus);
    process.exit(1);
});
