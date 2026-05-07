/*
 * Image fetcher + in-memory cache for the render path.
 *
 * Stage 6 Track B. The bridge can only `place()` filesystem paths,
 * so for each render we resolve image URLs -> bytes -> a per-render
 * working directory on disk -> pass that path to the bridge.
 *
 * Cache: process-lifetime Map keyed by URL with a 5-minute TTL. The
 * dashboard process restart clears it. Goal is a perceptible speedup
 * when the same comp appears in back-to-back renders, NOT a long-term
 * storage layer. Misses on TTL expiry are a feature: if Hannah
 * replaces a photo upstream, we want renders within a few minutes to
 * pick up the new bytes.
 *
 * Errors thrown here are user-visible via the render route's response
 * — keep the messages clear about which URL failed and why.
 */

import "server-only";

interface CacheEntry {
    bytes: Uint8Array;
    ext: string;
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

const EXT_BY_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/tiff": "tif",
};

function extFromUrl(url: string): string | null {
    // last path segment after the final dot, lowercased
    const m = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(url);
    if (!m) return null;
    const e = m[1].toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"].includes(e)) {
        return e === "jpeg" ? "jpg" : e;
    }
    return null;
}

function pickExt(contentType: string | null, url: string): string {
    if (contentType) {
        const cleaned = contentType.split(";")[0].trim().toLowerCase();
        if (EXT_BY_MIME[cleaned]) return EXT_BY_MIME[cleaned];
    }
    return extFromUrl(url) ?? "jpg";
}

export interface FetchedImage {
    bytes: Uint8Array;
    ext: string;
    cacheHit: boolean;
}

export async function fetchImage(url: string): Promise<FetchedImage> {
    const now = Date.now();
    const hit = cache.get(url);
    if (hit && now - hit.fetchedAt < TTL_MS) {
        return { bytes: hit.bytes, ext: hit.ext, cacheHit: true };
    }

    let res: Response;
    try {
        res = await fetch(url);
    } catch (e) {
        throw new Error(
            `Image fetch failed (network) for ${url}: ${(e as Error).message}`
        );
    }

    if (res.status === 404) {
        throw new Error(`Image not found at ${url}`);
    }
    if (!res.ok) {
        throw new Error(
            `Image fetch failed (HTTP ${res.status}) for ${url}`
        );
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const ext = pickExt(res.headers.get("content-type"), url);

    cache.set(url, { bytes: buf, ext, fetchedAt: now });
    return { bytes: buf, ext, cacheHit: false };
}

export function clearImageCache(): void {
    cache.clear();
}
