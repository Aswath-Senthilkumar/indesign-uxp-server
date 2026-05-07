import CompsPicker from "@/components/comps-picker";
import { getComps } from "@/lib/comps";

// Server Component: pulls live comps from Supabase (server-only) and
// hands them to the client picker. Selection state is held in
// BuildState (provider mounted in dashboard/app/build/layout.tsx).
//
// Stage 6: was reading mock-data/comps.json; now hits Supabase via
// dashboard/lib/comps.ts. The mock JSON file is intentionally retained
// on disk as a fallback reference but is no longer wired here.
export default async function BuildCompsPage() {
    const comps = await getComps();
    return <CompsPicker comps={comps} />;
}
