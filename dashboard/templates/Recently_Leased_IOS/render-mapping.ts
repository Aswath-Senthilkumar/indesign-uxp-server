/*
 * Per-template mapping: Comp record -> tile-field values.
 *
 * SCAFFOLD / contract file. The runtime render path
 * (dashboard/lib/render-script.mjs and dashboard/app/api/render/route.ts)
 * is currently hardcoded to this exact field set for the
 * Recently_Leased_IOS template. When a second template arrives that
 * uses different tile fields, the runtime will be refactored to import
 * each template's render-mapping at request time, and this file becomes
 * its canonical declaration.
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
    photo: string;
}

export function buildTilePayload(comp: Comp): TilePayload {
    return {
        address: comp.address,
        city_state: `${comp.city}, ${comp.state}`,
        sf_ac: formatSfAc(comp.building_sf, comp.land_area),
        photo: comp.image_filename,
    };
}
