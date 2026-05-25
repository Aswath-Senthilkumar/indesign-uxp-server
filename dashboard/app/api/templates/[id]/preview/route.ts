/**
 * GET /api/templates/[id]/preview — Phase 1 thin proxy.
 *
 * Forwards to GET ${RENDER_SERVICE_URL}/preview?template_id=<id> and
 * streams the PDF response back, preserving Content-Type,
 * Content-Disposition, and Cache-Control.
 */

import { type NextRequest } from "next/server";

const RENDER_SERVICE_URL =
    process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";

function copyResponseHeaders(src: Headers, dst: Headers): void {
    src.forEach((value, key) => {
        const k = key.toLowerCase();
        if (
            k === "content-length" ||
            k === "transfer-encoding" ||
            k === "connection"
        ) {
            return;
        }
        dst.set(key, value);
    });
}

export async function GET(
    _req: NextRequest,
    ctx: RouteContext<"/api/templates/[id]/preview">
) {
    const { id } = await ctx.params;

    let upstream: Response;
    try {
        upstream = await fetch(
            `${RENDER_SERVICE_URL}/preview?template_id=${encodeURIComponent(id)}`,
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

    const ct = upstream.headers.get("content-type") ?? "";
    if (!ct.includes("application/pdf")) {
        const text = await upstream.text();
        return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": ct || "application/json" },
        });
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const headers = new Headers();
    copyResponseHeaders(upstream.headers, headers);
    headers.set("Content-Length", String(bytes.length));
    return new Response(bytes, { status: upstream.status, headers });
}
