/*
 * Per-template mapping: Comp record -> tile-field values.
 *
 * SCAFFOLD / contract file. The runtime render path
 * (dashboard/lib/render-script.mjs and dashboard/app/api/render/route.ts)
 * is currently hardcoded to this exact field set for the
 * 6_Tile_Defaults template (originally shipped as Recently_Leased_IOS,
 * renamed in Stage 7). The Stage 7 manifest-driven render refactor is
 * what consumes this scaffold for templates with different field sets.
 *
 * Imports:
 *   - `Comp` and `formatSfAc` come from `@/lib/format` so the SF/AC
 *     formatting stays in one place. Do not redeclare them here.
 *
 * Keys on the returned object MUST match the `field` names declared in
 * this folder's manifest.json `tile_fields`. Values for image fields
 * are filenames (relative to the configured images directory) — the
 * runtime resolves them to absolute paths before passing to the bridge.
 */

import { type Comp, formatSfAc } from "@/lib/format";

export interface TilePayload {
    address: string;
    city_state: string;
    sf_ac: string;
    /**
     * Source URL for the photo (Stage 6: nullable Supabase storage URL).
     * The runtime resolves this to a per-render local file before
     * passing to the bridge — the bridge only knows how to `place()`
     * filesystem paths, not URLs. See Track B in STAGE-6-NOTES.md.
     */
    photo: string | null;
}

export function buildTilePayload(comp: Comp): TilePayload {
    return {
        address: comp.address,
        city_state: `${comp.city}, ${comp.state}`,
        sf_ac: formatSfAc(comp.building_sf, comp.land_area),
        photo: comp.image_url,
    };
}
