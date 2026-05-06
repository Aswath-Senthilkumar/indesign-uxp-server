import { promises as fs } from "node:fs";
import path from "node:path";
import CompsPicker from "@/components/comps-picker";
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

// Server Component: reads comps from disk and hands them to the client
// picker. Selection state is held in BuildState (provider mounted in
// dashboard/app/build/layout.tsx).
export default async function BuildCompsPage() {
    const comps = await loadComps();
    return <CompsPicker comps={comps} />;
}
