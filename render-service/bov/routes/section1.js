/**
 * POST /bov/section1/render
 *
 * Renders BOV Section 1 (3 pages: Similar Transactions, Executive Summary,
 * Pricing — sale scenario only).
 *
 * Body (JSON):
 *   tiles                    object[]   Up to 6 tile objects:
 *     .addressStatus         string     e.g. "2847 E Jones Ave | Sold"
 *     .sfOnAc                string     e.g. "±14,350 SF on ±1.88 AC"
 *     .imagePath             string|null  Absolute path to pre-staged image
 *   clientMention            string     Free text for client_mention frame
 *   propertyHighlightsValues string[]   4 values: [buildingSize, siteSize, zoning, apn]
 *   strengthsOpportunities   string     Newline-separated bullet points
 *   askingSalesPrice         string
 *   expectedSalesPrice       string
 *   projectedMarketingTime   string
 *
 * Response: application/pdf binary
 */

import { Router } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { bridgeExecute } from "../../core/bridge-client.js";
import { resolveTemplatePath } from "../../core/template-paths.js";
import config from "../../config.js";

const router = Router();

const SECTION1_MANIFEST = { id: "bov-section1", file: "BOV - Section 1.indd" };

function buildBridgeCode(templatePath, outputPdf, tiles, execSummary, pricing) {
    const lit = JSON.stringify;

    return `
        const { SaveOptions, UserInteractionLevels, OpenOptions, ExportFormat, FitOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;
        let doc; let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('no doc after open');

            // Helper: find any named item, checking document-level collections
            // first (fast), then deep-searching allPageItems for grouped frames.
            function findItem(name) {
                try {
                    const tf = doc.textFrames.itemByName(name);
                    if (tf.isValid) return tf;
                } catch(e) {}
                try {
                    const rect = doc.rectangles.itemByName(name);
                    if (rect.isValid) return rect;
                } catch(e) {}
                for (let p = 0; p < doc.pages.length; p++) {
                    const items = doc.pages.item(p).allPageItems;
                    for (let i = 0; i < items.length; i++) {
                        try {
                            if (items[i].name === name && items[i].isValid) return items[i];
                        } catch(e) {}
                    }
                }
                return null;
            }

            // ─── Page 1: Similar Transactions ────────────────────────────────
            const tilesData = ${lit(tiles)};
            for (let n = 0; n < tilesData.length; n++) {
                const idx = n + 1;
                const tile = tilesData[n];

                if (tile.addressStatus) {
                    const tf = findItem('tile_' + idx + '_address | status');
                    if (tf) tf.contents = tile.addressStatus;
                }
                if (tile.sfOnAc) {
                    const tf = findItem('tile_' + idx + '_sf_on_ac');
                    if (tf) tf.contents = tile.sfOnAc;
                }
                if (tile.imagePath) {
                    const rect = findItem('tile_' + idx + '_photo');
                    if (rect) {
                        try {
                            rect.place(tile.imagePath);
                            rect.fit(FitOptions.fillProportionally);
                        } catch(e) {}
                    }
                }
            }

            // ─── Page 2: Executive Summary ───────────────────────────────────
            const execData = ${lit(execSummary)};

            // ─── Page 1: Intro paragraph address ─────────────────────────────
            if (execData.similarTransactionsAddress) {
                const introTf = findItem('similar_transactions_intro_paragraph');
                if (introTf && introTf.isValid) {
                    const PLACEHOLDER = '788 W Illini St';
                    const current     = introTf.contents;
                    const pIdx        = current.indexOf(PLACEHOLDER);
                    if (pIdx >= 0) {
                        introTf.characters.itemByRange(pIdx, pIdx + PLACEHOLDER.length - 1).contents = execData.similarTransactionsAddress;
                    }
                }
            }

            if (execData.clientMention) {
                const tf = findItem('client_mention');
                if (tf) {
                    // If the template already has the full sentence (fresh INDD copy),
                    // do an in-place replacement so the pink character style is preserved.
                    const current = tf.contents;
                    const MARKER  = 'opinion of value to ';
                    const mIdx    = current.indexOf(MARKER);

                    if (mIdx >= 0) {
                        const nameStart = mIdx + MARKER.length;
                        const dotIdx    = current.indexOf('.', nameStart);
                        const nameEnd   = dotIdx > nameStart ? dotIdx - 1 : current.length - 1;
                        tf.characters.itemByRange(nameStart, nameEnd).contents = execData.clientMention;
                    } else {
                        // Frame holds only the client name — capture its pink before overwriting.
                        let savedColor = null;
                        let savedStyle = null;
                        try {
                            const c  = tf.characters.item(0);
                            const cs = c.appliedCharacterStyle;
                            if (cs && cs.isValid && cs.name !== '[None]') savedStyle = cs;
                            else savedColor = c.fillColor;
                        } catch(e) {}

                        const sentence = 'Rein & Grossoehme (“R&G”) is pleased to present this opinion of value to ' + execData.clientMention + '. Thank you for allowing us this opportunity. Attached is our valuation, property summary, and marketing proposal.';
                        tf.contents = sentence;

                        // Scan tf.characters directly to find the client name —
                        // avoids string-index mismatches between JS indexOf and
                        // InDesign's internal character collection offsets.
                        try {
                            const search   = execData.clientMention;
                            const nChars   = tf.characters.length;
                            let   foundAt  = -1;
                            outer: for (let i = 0; i <= nChars - search.length; i++) {
                                for (let j = 0; j < search.length; j++) {
                                    try {
                                        if (tf.characters.item(i + j).contents !== search[j]) continue outer;
                                    } catch(e) { continue outer; }
                                }
                                foundAt = i;
                                break;
                            }
                            if (foundAt >= 0 && (savedStyle || savedColor)) {
                                for (let ci = 0; ci < search.length; ci++) {
                                    const ch = tf.characters.item(foundAt + ci);
                                    try {
                                        if (savedStyle) ch.appliedCharacterStyle = savedStyle;
                                        else            ch.fillColor = savedColor;
                                    } catch(e) {}
                                }
                            }
                        } catch(e) {}
                    }
                }
            }

            if (execData.propertyHighlightsValues && execData.propertyHighlightsValues.length > 0) {
                const tf = findItem('property_highlights_values');
                if (tf && tf.isValid) tf.contents = execData.propertyHighlightsValues.join('\\r');
            }

            if (execData.propertyHighlightsKeys && execData.propertyHighlightsKeys.length > 0) {
                const tf = findItem('property_highlights_labels') ||
                           findItem('property_highlights_keys');
                if (tf && tf.isValid) tf.contents = execData.propertyHighlightsKeys.join('\\r');
            }

            if (execData.strengthsOpportunities) {
                const tf = findItem('property_assessment_strengths_opportunities_points');
                if (tf && tf.isValid) {
                    const text = execData.strengthsOpportunities
                        .replace(/\\r\\n/g, '\\r')
                        .replace(/\\n/g, '\\r')
                        .replace(/\\r\\r+/g, '\\r');
                    tf.contents = text;
                }
            }

            // ─── Page 3: Pricing ─────────────────────────────────────────────
            const pricingData = ${lit(pricing)};

            if (pricingData.askingSalesPrice) {
                const tf = findItem('asking_sales_price');
                if (tf) tf.contents = pricingData.askingSalesPrice;
            }
            if (pricingData.expectedSalesPrice) {
                const tf = findItem('expected_sales_price');
                if (tf) tf.contents = pricingData.expectedSalesPrice;
            }
            if (pricingData.projectedMarketingTime) {
                const tf = findItem('projected_marketing_time');
                if (tf && tf.isValid) {
                    const current = tf.contents;
                    const MARKER  = 'Projected Marketing Time:';
                    const mIdx    = current.indexOf(MARKER);
                    if (mIdx >= 0) {
                        const valStart = mIdx + MARKER.length;
                        const valEnd   = current.trimEnd().length - 1;
                        tf.characters.itemByRange(valStart, valEnd).contents = ' ' + pricingData.projectedMarketingTime;
                    } else {
                        tf.contents = 'Projected Marketing Time: ' + pricingData.projectedMarketingTime;
                    }
                }
            }
            if (pricingData.pricingParagraph) {
                const tf = findItem('pricing_paragraph');
                if (tf && tf.isValid) {
                    tf.contents = pricingData.pricingParagraph
                        .replace(/\\r\\n/g, '\\r')
                        .replace(/\\n/g,   '\\r')
                        .replace(/\\r\\r+/g, '\\r');
                }
            }
            if (pricingData.conclusionParagraph) {
                const tf = findItem('conclusion_paragraph');
                if (tf && tf.isValid) {
                    // Blank lines between paragraphs → single paragraph break
                    tf.contents = pricingData.conclusionParagraph
                        .replace(/\\r\\n/g, '\\n')
                        .replace(/\\r/g,   '\\n')
                        .replace(/\\n\\n+/g, '\\r')
                        .replace(/\\n/g,    '\\r');
                }
            }

            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            result = { ok: true };
        } catch(e) {
            result = { ok: false, error: e.message };
        }
        if (doc) { try { await doc.close(SaveOptions.no); } catch(e) {} }
        return result;
    `;
}

router.post("/section1/render", async (req, res) => {
    const {
        tiles             = [],
        similarTransactionsAddress,
        clientMention,
        propertyHighlightsValues,
        propertyHighlightsKeys,
        strengthsOpportunities,
        askingSalesPrice,
        expectedSalesPrice,
        projectedMarketingTime,
        pricingParagraph,
        conclusionParagraph,
    } = req.body;

    const templatePath = resolveTemplatePath(SECTION1_MANIFEST);
    try { await fs.access(templatePath); } catch {
        return res.status(503).json({
            error: "BOV Section 1 template not found",
            expected: templatePath,
            hint: "Drop BOV - Section 1.indd into TEMPLATES_DIR and restart.",
        });
    }

    await fs.mkdir(config.outputDir,  { recursive: true });
    await fs.mkdir(config.workingDir, { recursive: true });

    const renderId  = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    const outputPdf = path.join(config.outputDir, `bov-section1-${renderId}.pdf`);

    const safeHigh = Array.isArray(propertyHighlightsValues) ? propertyHighlightsValues : [];
    const safeKeys = Array.isArray(propertyHighlightsKeys)   ? propertyHighlightsKeys   : [];

    const code = buildBridgeCode(
        templatePath,
        outputPdf,
        tiles,
        {
            similarTransactionsAddress: similarTransactionsAddress || null,
            clientMention:              clientMention              || null,
            propertyHighlightsValues:   safeHigh,
            propertyHighlightsKeys:     safeKeys,
            strengthsOpportunities:     strengthsOpportunities     || null,
        },
        {
            askingSalesPrice:       askingSalesPrice       || null,
            expectedSalesPrice:     expectedSalesPrice     || null,
            projectedMarketingTime: projectedMarketingTime || null,
            pricingParagraph:       pricingParagraph       || null,
            conclusionParagraph:    conclusionParagraph    || null,
        }
    );

    let bridgeResult;
    try {
        bridgeResult = await bridgeExecute(code);
    } catch (e) {
        console.error("[bov/section1] bridge threw:", e.message);
        return res.status(502).json({ error: e.message, detail: e.code ?? "BRIDGE_ERROR" });
    }

    if (!bridgeResult || bridgeResult.ok !== true) {
        console.error("[bov/section1] render failed:", bridgeResult?.error);
        return res.status(500).json({ error: bridgeResult?.error ?? "render failed", detail: "indesign script error" });
    }

    let pdfBytes;
    try {
        pdfBytes = await fs.readFile(outputPdf);
    } catch (e) {
        return res.status(500).json({ error: "pdf not found after render", detail: e.message });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBytes.length);
    res.send(pdfBytes);

    fs.unlink(outputPdf).catch(() => {});
});

export default router;
