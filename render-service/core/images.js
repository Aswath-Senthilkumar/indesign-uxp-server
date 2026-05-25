/**
 * Image fetcher + in-memory cache for the render path.
 *
 * The bridge can only `place()` filesystem paths, so for each render
 * the service resolves image URLs -> bytes -> a per-render working
 * directory on disk -> passes that path to the bridge.
 *
 * Cache: process-lifetime Map keyed by URL with a 5-minute TTL. Goal
 * is a perceptible speedup when the same comp appears in back-to-back
 * renders, NOT a long-term storage layer. TTL expiry is a feature: if
 * the photo upstream is replaced, renders within a few minutes pick
 * up the new bytes.
 */

const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

const EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/tiff": "tif",
};

function extFromUrl(url) {
    const m = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(url);
    if (!m) return null;
    const e = m[1].toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"].includes(e)) {
        return e === "jpeg" ? "jpg" : e;
    }
    return null;
}

function pickExt(contentType, url) {
    if (contentType) {
        const cleaned = contentType.split(";")[0].trim().toLowerCase();
        if (EXT_BY_MIME[cleaned]) return EXT_BY_MIME[cleaned];
    }
    return extFromUrl(url) ?? "jpg";
}

/**
 * @returns {Promise<{ bytes: Uint8Array, ext: string, cacheHit: boolean }>}
 */
export async function fetchImage(url) {
    const now = Date.now();
    const hit = cache.get(url);
    if (hit && now - hit.fetchedAt < TTL_MS) {
        return { bytes: hit.bytes, ext: hit.ext, cacheHit: true };
    }

    let res;
    try {
        res = await fetch(url);
    } catch (e) {
        throw new Error(`Image fetch failed (network) for ${url}: ${e.message}`);
    }

    if (res.status === 404) {
        throw new Error(`Image not found at ${url}`);
    }
    if (!res.ok) {
        throw new Error(`Image fetch failed (HTTP ${res.status}) for ${url}`);
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const ext = pickExt(res.headers.get("content-type"), url);

    cache.set(url, { bytes: buf, ext, fetchedAt: now });
    return { bytes: buf, ext, cacheHit: false };
}

export function clearImageCache() {
    cache.clear();
}
