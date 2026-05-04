/**
 * GET /api/images/<filename>
 *
 * Serves a comp image from `<repo>/mock-data/images/<filename>` so the
 * dashboard's picker can show thumbnails without us copying the
 * binaries into `public/`.
 *
 * The `[filename]` segment is user-controlled (it's in the URL), so
 * this is the one surface in Stage 4 that absolutely needs path-
 * traversal protection. The route validates that:
 *   - the filename has no separators, parent-dir tokens, or NUL bytes
 *   - the resolved path is under IMAGES_DIR
 *   - the file exists and is reasonable-sized (<5 MB defensive cap)
 */

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const IMAGES_DIR = path.join(REPO_ROOT, "mock-data", "images");
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const CONTENT_TYPE: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
};

export async function GET(
    _req: NextRequest,
    ctx: RouteContext<"/api/images/[filename]">
) {
    const { filename } = await ctx.params;

    if (typeof filename !== "string" || filename.length === 0) {
        return NextResponse.json({ error: "missing filename" }, { status: 400 });
    }
    if (!SAFE_NAME.test(filename) || filename.includes("..")) {
        return NextResponse.json({ error: "invalid filename" }, { status: 400 });
    }
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "unsupported extension" }, { status: 400 });
    }

    const resolved = path.resolve(IMAGES_DIR, filename);
    if (
        !resolved.startsWith(IMAGES_DIR + path.sep) &&
        resolved !== IMAGES_DIR
    ) {
        return NextResponse.json({ error: "path traversal blocked" }, { status: 400 });
    }

    let bytes: Buffer;
    try {
        const stat = await fs.stat(resolved);
        if (stat.size > MAX_IMAGE_BYTES) {
            return NextResponse.json({ error: "image too large" }, { status: 413 });
        }
        bytes = await fs.readFile(resolved);
    } catch {
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
            "Content-Type": CONTENT_TYPE[ext] ?? "application/octet-stream",
            "Content-Length": String(bytes.length),
            // small dev-friendly cache; we'll see what the browser does on its own
            "Cache-Control": "private, max-age=300",
        },
    });
}
