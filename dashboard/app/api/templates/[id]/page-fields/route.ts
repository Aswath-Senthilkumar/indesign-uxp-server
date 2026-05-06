/**
 * GET /api/templates/[id]/page-fields
 *
 * Reads the current contents of each editable `page_field` declared in
 * the manifest, AND returns the field metadata (label, frame name) so
 * the dashboard's edit stage can render inputs in one round trip.
 *
 * Response shape:
 *   {
 *     fields: [
 *       { field, frame, label, current_value, missing }
 *     ]
 *   }
 *
 * `field` is the manifest field name (e.g. "title"). `label` is the
 * humanized form ("Title"). `current_value` is whatever the frame
 * currently contains in the template; "" when the frame is missing.
 * `missing: true` flags frames that aren't named in the .indd.
 *
 * Same isolation model as everything else: opens via `OpenOptions.openCopy`
 * so the template file is never bound or modified, closes cleanly after.
 */

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getTemplate } from "@/lib/manifest";

const BRIDGE_URL = "http://127.0.0.1:3000";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");

const lit = (s: string) => JSON.stringify(s);

interface BridgeReadbackResult {
    ok: boolean;
    error?: string;
    fields?: Record<string, string>;
    missing?: string[];
}

function buildReadbackCode(
    templatePath: string,
    fields: Array<{ field: string; frame: string }>
): string {
    return `
        const { SaveOptions, UserInteractionLevels, OpenOptions } = require('indesign');
        app.scriptPreferences.userInteractionLevel = UserInteractionLevels.neverInteract;

        const fields = ${JSON.stringify(fields)};
        const out = {};
        const missing = [];

        let doc;
        let result;
        try {
            doc = await app.open(${lit(templatePath)}, true, OpenOptions.openCopy);
            if (!doc) doc = app.activeDocument;
            if (!doc) throw new Error('app.open returned no document');

            for (const f of fields) {
                const frame = doc.textFrames.itemByName(f.frame);
                if (frame.isValid) {
                    out[f.field] = frame.contents || '';
                } else {
                    missing.push(f.frame);
                }
            }
            result = { ok: true, fields: out, missing };
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
    ctx: RouteContext<"/api/templates/[id]/page-fields">
) {
    const { id } = await ctx.params;

    const tpl = await getTemplate(id);
    if (!tpl) {
        return NextResponse.json(
            { error: `unknown template id: ${id}` },
            { status: 404 }
        );
    }

    const editableFields = tpl.page_fields
        .filter((f) => f.editable)
        .map((f) => ({ field: f.field, frame: f.frame }));

    if (editableFields.length === 0) {
        // Template has no editable page fields. Don't touch the bridge —
        // just return an empty payload.
        return NextResponse.json({ fields: [] });
    }

    function humanize(field: string): string {
        return field
            .split("_")
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(" ");
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

    // Bridge connectivity check
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

    let result: BridgeReadbackResult | null = null;
    try {
        const r = await fetch(`${BRIDGE_URL}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                code: buildReadbackCode(templatePath, editableFields),
            }),
            cache: "no-store",
        });
        const body = (await r.json()) as { result?: BridgeReadbackResult; error?: string };
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
            { error: "page-fields readback failed", detail: result?.error ?? "unknown" },
            { status: 500 }
        );
    }

    const values = result.fields ?? {};
    const missingSet = new Set(result.missing ?? []);

    const merged = editableFields.map(({ field, frame }) => ({
        field,
        frame,
        label: humanize(field),
        current_value: values[field] ?? "",
        missing: missingSet.has(frame),
    }));

    return NextResponse.json(
        { fields: merged },
        {
            // The values come from the .indd which can change underneath us.
            // Short cache lets multiple components share a fetch within the
            // same edit session without missing user-side .indd edits.
            headers: { "Cache-Control": "private, max-age=30" },
        }
    );
}
