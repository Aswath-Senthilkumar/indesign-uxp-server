import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const RENDER_SERVICE = process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";
// output/ lives one level above the dashboard directory (repo root/output/)
const OUTPUT_DIR = path.resolve(process.cwd(), "..", "output");

export async function POST(request: NextRequest) {
    const formData = await request.formData();

    const coverDate              = formData.get("cover_date")              as string | null;
    const clientName             = formData.get("client_name")             as string | null;
    const clientPropertyAddress  = formData.get("client_property_address") as string | null;
    const coverImage             = formData.get("cover_image")             as File   | null;
    const section6DisabledRaw    = formData.get("section6_disabled")       as string | null;

    const section6Disabled: string[] = section6DisabledRaw
        ? JSON.parse(section6DisabledRaw)
        : [];

    // Stage image locally so InDesign can access it via absolute path
    let coverImagePath: string | null = null;
    let stagedImagePath: string | null = null;
    if (coverImage && coverImage.size > 0) {
        await mkdir(OUTPUT_DIR, { recursive: true });
        const ext = coverImage.name.split(".").pop() ?? "jpg";
        const tempName = `bov-cover-img-${randomBytes(4).toString("hex")}.${ext}`;
        stagedImagePath = path.join(OUTPUT_DIR, tempName);
        const bytes = await coverImage.arrayBuffer();
        await writeFile(stagedImagePath, Buffer.from(bytes));
        // Forward slashes for InDesign on Windows
        coverImagePath = stagedImagePath.replace(/\\/g, "/");
    }

    try {
        const renderRes = await fetch(`${RENDER_SERVICE}/bov/cover/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                cover_date:              coverDate              || null,
                client_name:             clientName             || null,
                client_property_address: clientPropertyAddress  || null,
                cover_image_path:        coverImagePath,
                section6_disabled:       section6Disabled,
            }),
        });

        if (!renderRes.ok) {
            const err = await renderRes.json().catch(() => ({}));
            return NextResponse.json(
                { error: "render failed", detail: err },
                { status: renderRes.status }
            );
        }

        const pdfBytes = await renderRes.arrayBuffer();
        return new NextResponse(pdfBytes, {
            headers: { "Content-Type": "application/pdf" },
        });
    } finally {
        if (stagedImagePath) {
            unlink(stagedImagePath).catch(() => {});
        }
    }
}
