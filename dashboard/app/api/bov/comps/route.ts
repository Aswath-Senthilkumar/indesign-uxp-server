import { NextResponse } from "next/server";
import { getComps } from "@/lib/comps";

export async function GET() {
    try {
        const comps = await getComps();
        return NextResponse.json(comps);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to load comps";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
