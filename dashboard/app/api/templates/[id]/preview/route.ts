/**
 * GET /api/templates/[id]/preview
 *
 * Renders the named template AS-IS (no tile data populated) and streams
 * the PDF back inline so the browser's PDF viewer handles display +
 * download. Used by the "Preview" button on each template card in the
 * picker.
 *
 * Same isolation model as `/api/render`: opens via `OpenOptions.openCopy`
 * so the original template file is never bound or modified.
 */

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getTemplate } from "@/lib/manifest";

const BRIDGE_URL = "http://127.0.0.1:3000";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const OUTPUT_DIR = path.join(REPO_ROOT, "output");

const lit = (s: string) => JSON.stringify(s);

interface PreviewBridgeResult {
    ok: boolean;
    error?: string;
}

function buildPreviewCode(templatePath: string, outputPdf: string): string {
    return `
        const { ExportFormat, SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('app.open returned no document');
            await doc.exportFile(ExportFormat.pdfType, ${lit(outputPdf)}, false);
            result = { ok: true };
        } catch (e) {
            result = { ok: false, error: e.message || String(e) };
        }
        if (doc) {
            try { await doc.close(SaveOptions.no); } catch (e) { /* swallow */ }
        }
        return result;
    `;
}

export async function GET(
    _req: NextRequest,
    ctx: RouteContext<"/api/templates/[id]/preview">
) {
    const { id } = await ctx.params;

    const tpl = await getTemplate(id);
    if (!tpl) {
        return NextResponse.json(
            { error: `unknown template id: ${id}` },
            { status: 404 }
        );
    }

    const templatePath = path.resolve(REPO_ROOT, tpl.file);
    try {
        await fs.access(templatePath);
    } catch {
        return NextResponse.json(
            { error: "template file not found", expected: templatePath },
            { status: 500 }
        );
    }

    // Bridge connectivity check up front so we don't generate temp paths
    // pointlessly.
    try {
        const r = await fetch(`${BRIDGE_URL}/status`, { cache: "no-store" });
        if (!r.ok) throw new Error(`/status returned ${r.status}`);
        const s = (await r.json()) as { connected?: boolean };
        if (!s.connected) {
            return NextResponse.json(
                {
                    error: "bridge says plugin not connected",
                    hint: "open InDesign with the Bridge Panel loaded",
                },
                { status: 503 }
            );
        }
    } catch (e) {
        return NextResponse.json(
            {
                error: "bridge unreachable on 127.0.0.1:3000",
                hint: "start the bridge: cd bridge && node server.js",
                detail: (e as Error).message,
            },
            { status: 503 }
        );
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outputPdf = path.join(
        OUTPUT_DIR,
        `template-preview-${id}-${Date.now()}.pdf`
    );

    let result: PreviewBridgeResult | null = null;
    try {
        const r = await fetch(`${BRIDGE_URL}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: buildPreviewCode(templatePath, outputPdf) }),
            cache: "no-store",
        });
        const body = (await r.json()) as { result?: PreviewBridgeResult; error?: string };
        if (!r.ok) {
            return NextResponse.json(
                { error: "bridge call failed", detail: body.error },
                { status: 502 }
            );
        }
        result = body.result ?? null;
    } catch (e) {
        return NextResponse.json(
            { error: "bridge call failed", detail: (e as Error).message },
            { status: 502 }
        );
    }

    if (!result || result.ok !== true) {
        return NextResponse.json(
            { error: "preview render failed", detail: result?.error ?? "unknown" },
            { status: 500 }
        );
    }

    let pdfBytes: Buffer;
    try {
        pdfBytes = await fs.readFile(outputPdf);
    } catch (e) {
        return NextResponse.json(
            {
                error: "preview reported success but PDF not found on disk",
                expected: outputPdf,
                detail: (e as Error).message,
            },
            { status: 500 }
        );
    }

    fs.unlink(outputPdf).catch(() => {
        /* output/ is gitignored */
    });

    return new Response(new Uint8Array(pdfBytes), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(pdfBytes.length),
            // inline + filename hint so the browser viewer shows it instead of
            // immediately downloading, but a "Save" still produces a sensible name.
            "Content-Disposition": `inline; filename="${tpl.label.replace(/[^A-Za-z0-9 _.-]/g, "_")}.pdf"`,
            // Don't cache aggressively — preview content depends on the
            // .indd which can change underneath us during dev.
            "Cache-Control": "private, max-age=10",
        },
    });
}
