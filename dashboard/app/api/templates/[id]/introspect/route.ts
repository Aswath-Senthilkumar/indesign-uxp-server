/**
 * POST /api/templates/[id]/introspect
 *
 * Resolves runtime info (tile_count) for the given template id. Looks up
 * the template's file path in the manifest, then delegates to
 * dashboard/lib/template-introspect.ts which queries the bridge.
 *
 * Returns: `{ tileCount: number, sampleFrames?: string[] }` on success,
 * `{ error, ... }` on failure (404 unknown id, 502 bridge problem,
 * 500 misconfig).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getTemplate } from "@/lib/manifest";
import { getTemplateIntrospection } from "@/lib/template-introspect";

export async function POST(
    _req: NextRequest,
    ctx: RouteContext<"/api/templates/[id]/introspect">
) {
    const { id } = await ctx.params;

    const tpl = await getTemplate(id);
    if (!tpl) {
        return NextResponse.json(
            { error: `unknown template id: ${id}` },
            { status: 404 }
        );
    }

    try {
        const result = await getTemplateIntrospection(tpl.id, tpl.file);
        return NextResponse.json({
            tileCount: result.tileCount,
            templatePath: result.templatePath,
            // Echo the manifest's grid hint so the client can drive its
            // edit-stage layout without a second round-trip.
            gridCols: tpl.grid?.cols,
            // Stage 7.3: ship the tile-field list so the edit-stage tile
            // cards know which fields the selected template uses (e.g.
            // whether to render the status badge and price line).
            tileFieldNames: tpl.tile_fields.map((f) => f.field),
        });
    } catch (e) {
        const msg = (e as Error).message;
        // Heuristic: bridge-related failures vs everything else.
        const isBridge =
            msg.startsWith("bridge unreachable") ||
            msg.startsWith("bridge returned");
        return NextResponse.json(
            { error: "introspection failed", detail: msg },
            { status: isBridge ? 502 : 500 }
        );
    }
}
