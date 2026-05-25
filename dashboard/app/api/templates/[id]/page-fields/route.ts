/**
 * GET /api/templates/[id]/page-fields — Phase 1 thin proxy.
 *
 * Forwards to GET ${RENDER_SERVICE_URL}/page-fields?template_id=<id>.
 * Preserves the service's `Cache-Control` header.
 */

import { type NextRequest } from "next/server";

const RENDER_SERVICE_URL =
    process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";

export async function GET(
    _req: NextRequest,
    ctx: RouteContext<"/api/templates/[id]/page-fields">
) {
    const { id } = await ctx.params;

    let upstream: Response;
    try {
        upstream = await fetch(
            `${RENDER_SERVICE_URL}/page-fields?template_id=${encodeURIComponent(id)}`,
            { cache: "no-store" }
        );
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
    const headers = new Headers();
    const ct = upstream.headers.get("content-type") ?? "application/json";
    headers.set("Content-Type", ct);
    const cc = upstream.headers.get("cache-control");
    if (cc) headers.set("Cache-Control", cc);
    return new Response(text, { status: upstream.status, headers });
}
