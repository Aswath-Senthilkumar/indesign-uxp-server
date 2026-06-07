import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const RENDER_SERVICE = process.env.RENDER_SERVICE_URL ?? "http://127.0.0.1:8765";
const OUTPUT_DIR = path.resolve(process.cwd(), "..", "output");

async function stageUrl(url: string, prefix: string): Promise<string | null> {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const buf = await resp.arrayBuffer();
        const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "jpg";
        const name = `${prefix}-${randomBytes(4).toString("hex")}.${ext}`;
        const staged = path.join(OUTPUT_DIR, name);
        await mkdir(OUTPUT_DIR, { recursive: true });
        await writeFile(staged, Buffer.from(buf));
        return staged.replace(/\\/g, "/");
    } catch {
        return null;
    }
}

export async function POST(request: NextRequest) {
    const formData = await request.formData();

    const stagedPaths: string[] = [];
    const tiles: { addressStatus: string; sfOnAc: string; imagePath: string | null }[] = [];

    for (let i = 1; i <= 6; i++) {
        const addressStatus = (formData.get(`tile_${i}_address_status`) as string | null) ?? "";
        const sfOnAc        = (formData.get(`tile_${i}_sf_on_ac`)        as string | null) ?? "";
        const imageFile     =  formData.get(`tile_${i}_image`)            as File   | null;
        const imageUrl      = (formData.get(`tile_${i}_image_url`)        as string | null);

        let imagePath: string | null = null;

        if (imageFile && imageFile.size > 0) {
            await mkdir(OUTPUT_DIR, { recursive: true });
            const ext      = imageFile.name.split(".").pop() ?? "jpg";
            const tempName = `bov-s1-t${i}-${randomBytes(4).toString("hex")}.${ext}`;
            const staged   = path.join(OUTPUT_DIR, tempName);
            await writeFile(staged, Buffer.from(await imageFile.arrayBuffer()));
            stagedPaths.push(staged);
            imagePath = staged.replace(/\\/g, "/");
        } else if (imageUrl) {
            const staged = await stageUrl(imageUrl, `bov-s1-t${i}`);
            if (staged) {
                stagedPaths.push(staged);
                imagePath = staged;
            }
        }

        tiles.push({ addressStatus, sfOnAc, imagePath });
    }

    // Parse highlights JSON (new format) — fall back to legacy individual fields
    const highlightsJson = formData.get("property_highlights_json") as string | null;
    let propertyHighlightsValues: string[] = [];
    let propertyHighlightsKeys:   string[] = [];

    if (highlightsJson) {
        const rows = JSON.parse(highlightsJson) as { key: string; value: string }[];
        propertyHighlightsValues = rows.map(r => r.value);
        propertyHighlightsKeys   = rows.map(r => r.key);
    } else {
        propertyHighlightsValues = [
            (formData.get("building_size") as string | null) ?? "",
            (formData.get("site_size")     as string | null) ?? "",
            (formData.get("zoning")        as string | null) ?? "",
            (formData.get("apn")           as string | null) ?? "",
        ].filter(Boolean);
    }

    const body = {
        tiles,
        similarTransactionsAddress: (formData.get("similar_transactions_address") as string | null) || null,
        clientMention:              (formData.get("client_mention")                as string | null) || null,
        propertyHighlightsValues: propertyHighlightsValues,
        propertyHighlightsKeys:   propertyHighlightsKeys,
        strengthsOpportunities:   (formData.get("strengths_opportunities")  as string | null) || null,
        askingSalesPrice:         (formData.get("asking_sales_price")        as string | null) || null,
        expectedSalesPrice:       (formData.get("expected_sales_price")      as string | null) || null,
        projectedMarketingTime:   (formData.get("projected_marketing_time")  as string | null) || null,
        pricingParagraph:         (formData.get("pricing_paragraph")         as string | null) || null,
        conclusionParagraph:      (formData.get("conclusion_paragraph")      as string | null) || null,
    };

    try {
        const renderRes = await fetch(`${RENDER_SERVICE}/bov/section1/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        if (!renderRes.ok) {
            const err = await renderRes.json().catch(() => ({}));
            return NextResponse.json(err, { status: renderRes.status });
        }

        const pdfBytes = await renderRes.arrayBuffer();
        return new NextResponse(pdfBytes, {
            headers: { "Content-Type": "application/pdf" },
        });
    } finally {
        for (const p of stagedPaths) {
            unlink(p).catch(() => {});
        }
    }
}
