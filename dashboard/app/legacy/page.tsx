/**
 * Stage 4 picker UI, kept reachable at /legacy during Stage 5
 * development. The Stage 5 build flow at /build/* is the primary
 * entry point; / redirects there.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import Picker from "@/components/picker";
import { type Comp } from "@/lib/format";

const REPO_ROOT =
    process.env.INDESIGN_REPO_ROOT ?? path.resolve(process.cwd(), "..");
const COMPS_PATH = path.join(REPO_ROOT, "mock-data", "comps.json");

async function loadComps(): Promise<Comp[]> {
    const raw = await fs.readFile(COMPS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Comp[];
    return parsed.map((c) => ({
        id: c.id,
        address: c.address,
        city: c.city,
        state: c.state,
        building_sf: c.building_sf,
        land_area: c.land_area,
        image_filename: c.image_filename,
    }));
}

export default async function LegacyHome() {
    const comps = await loadComps();

    return (
        <main className="mx-auto max-w-5xl px-6 py-10">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight">
                    Team Sheet Renderer (legacy)
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Stage 4 flat picker. The current flow is at{" "}
                    <a href="/build/template" className="underline">
                        /build/template
                    </a>
                    .
                </p>
            </header>

            <div className="mt-8">
                <Picker comps={comps} />
            </div>
        </main>
    );
}
