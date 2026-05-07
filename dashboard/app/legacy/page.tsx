/**
 * Stage 4 picker UI, kept reachable at /legacy during Stage 5
 * development. The Stage 5 build flow at /build/* is the primary
 * entry point; / redirects there.
 *
 * Stage 6: source-of-truth swapped from mock-data/comps.json to
 * Supabase via getComps(). The render path this picker submits into
 * is broken between Tracks A and B (the route still expects local
 * image filenames) — fixed in Track B.
 */

import Picker from "@/components/picker";
import { getComps } from "@/lib/comps";

export default async function LegacyHome() {
    const comps = await getComps();

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
