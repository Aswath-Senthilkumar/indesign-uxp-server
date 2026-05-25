/**
 * POST /api/render — Phase 1 thin proxy.
 *
 * Forwards to the standalone render service (default
 * http://127.0.0.1:8765/render). The dashboard no longer owns the
 * bridge connection, manifest scanning, Supabase access, or image
 * staging — all of that lives in render-service/.
 *
 * Client contract is unchanged: the UI still POSTs
 *   { template_id, comps: Comp[], tile_count, page_overrides? }
 * The proxy extracts `comp_ids = comps.map(c => c.id)` and forwards the
 * new IDs-only contract to the service. tile_count is dropped — the
 * service derives it from template introspection.
 *
 * Phase 2 will rewrite the UI to send comp_ids directly and remove this
 * proxy. See phase1-report.md for the full Phase 2 brief.
 */

const RENDER_SERVICE_URL =
    process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";

type Json = Record<string, unknown>;

function copyResponseHeaders(src: Headers, dst: Headers): void {
    src.forEach((value, key) => {
        const k = key.toLowerCase();
        // Hop-by-hop / transport headers that must not be re-forwarded.
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

export async function POST(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
        return Response.json(
            { error: "validation failed", details: [{ field: "body", message: "expected JSON object" }] },
            { status: 400 }
        );
    }
    const b = body as Json;

    const template_id = b.template_id;
    const comps = b.comps;
    const page_overrides = b.page_overrides ?? {};

    if (typeof template_id !== "string" || template_id.length === 0) {
        return Response.json(
            {
                error: "validation failed",
                details: [{ field: "template_id", message: "expected non-empty string" }],
            },
            { status: 400 }
        );
    }
    if (!Array.isArray(comps)) {
        return Response.json(
            {
                error: "validation failed",
                details: [{ field: "comps", message: "expected array" }],
            },
            { status: 400 }
        );
    }

    const comp_ids: string[] = [];
    const idErrors: Array<{ field: string; message: string }> = [];
    comps.forEach((c, i) => {
        const id = (c as Json | null)?.id;
        if (typeof id !== "string" || id.length === 0) {
            idErrors.push({ field: `comps[${i}].id`, message: "missing or empty" });
        } else {
            comp_ids.push(id);
        }
    });
    if (idErrors.length > 0) {
        return Response.json(
            { error: "validation failed", details: idErrors },
            { status: 400 }
        );
    }

    let upstream: Response;
    try {
        upstream = await fetch(`${RENDER_SERVICE_URL}/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template_id, comp_ids, page_overrides }),
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

    // Pass JSON errors straight through (preserve the service's status
    // and error shape — the UI already knows how to render error/detail/
    // hint/details/missing).
    const ct = upstream.headers.get("content-type") ?? "";
    if (!ct.includes("application/pdf")) {
        const text = await upstream.text();
        return new Response(text, {
            status: upstream.status,
            headers: { "Content-Type": ct || "application/json" },
        });
    }

    // PDF — forward bytes + X-Render-* headers.
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const headers = new Headers();
    copyResponseHeaders(upstream.headers, headers);
    headers.set("Content-Length", String(bytes.length));
    return new Response(bytes, { status: upstream.status, headers });
}
