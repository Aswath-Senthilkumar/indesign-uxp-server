/**
 * POST /api/templates/[id]/introspect — Phase 1 thin proxy.
 *
 * Forwards to the standalone render service at POST /introspect with
 * the template_id moved into the JSON body. Response shape is
 * unchanged from the client's perspective.
 */

import { type NextRequest } from "next/server";

const RENDER_SERVICE_URL =
    process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";

export async function POST(
    _req: NextRequest,
    ctx: RouteContext<"/api/templates/[id]/introspect">
) {
    const { id } = await ctx.params;

    let upstream: Response;
    try {
        upstream = await fetch(`${RENDER_SERVICE_URL}/introspect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template_id: id }),
            cache: "no-store",
        });
    } catch (e) {
        return Response.json(
            {
                error: `render service unreachable at ${RENDER_SERVICE_URL}`,
                hint: "start the render service: cd render-service && npm start",
                detail: (e as Error).message,
            },
            { status: 503 }
        );
    }

    const text = await upstream.text();
    const ct = upstream.headers.get("content-type") ?? "application/json";
    return new Response(text, {
        status: upstream.status,
        headers: { "Content-Type": ct },
    });
}
