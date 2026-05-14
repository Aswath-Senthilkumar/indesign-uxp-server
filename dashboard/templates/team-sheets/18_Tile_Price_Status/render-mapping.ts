/*
 * Per-template mapping: Comp record -> tile-field values.
 *
 * Stage 7: this template was the trigger for the manifest-driven
 * render refactor. The route's `resolveTileFieldValue()` now dispatches
 * by the manifest's `field` name; this file is the canonical
 * declaration of what each field resolves to for this template (and
 * mirrors the dispatch table — keep them in sync).
 *
 * Imports shared formatters from `@/lib/format` (no duplication of
 * formatSfAc, formatPriceLine, formatStatusBadge).
 */

import {
    type Comp,
    formatPriceLine,
    formatSfAc,
    formatStatusBadge,
} from "@/lib/format";

export interface TilePayload {
    address: string;
    city_state: string;
    sf_ac: string;
    price: string;
    status: string;
    /**
     * Source URL for the photo (Stage 6: nullable Supabase storage URL).
     * The runtime resolves this to a per-render local file before
     * passing to the bridge.
     */
    photo: string | null;
}

export function buildTilePayload(comp: Comp): TilePayload {
    return {
        address: comp.address,
        city_state: `${comp.city}, ${comp.state}`,
        sf_ac: formatSfAc(comp.building_sf, comp.land_area),
        price: formatPriceLine({
            sale_price: comp.sale_price,
            base_rent_total: comp.base_rent_total,
            lease_format: comp.lease_format,
        }),
        status: formatStatusBadge(comp.status),
        photo: comp.image_url,
    };
}
