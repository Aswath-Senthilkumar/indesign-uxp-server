/*
 * Live comps data layer.
 *
 * Server-only; depends on dashboard/lib/supabase.ts which imports
 * `server-only`. The dashboard's three-stage build flow reads from
 * here instead of mock-data/comps.json.
 *
 * Scope: SELECT only. No mutations.
 *
 * Stage 6 schema mapping:
 *   The Supabase `comps` row carries more fields than the v1 mock
 *   data. We project the columns the dashboard actually consumes plus
 *   a few that drive Track C's filter UI, and shape them into the
 *   `Comp` interface in @/lib/format. `image_url` replaces the v1
 *   `image_filename` (mock data lived on local disk; live data lives
 *   in the public `comp-images` Supabase bucket).
 *
 *   Many live rows have null `image_url` — Track B decides how the
 *   render path handles this; Track C surfaces a visual flag.
 */

import "server-only";
import { supabase } from "./supabase";
import type { Comp } from "./format";

/*
 * Schema notes (verified against information_schema):
 *   - There is no `lease_rate` column. The CRE-equivalent per-sqft
 *     annual figure is `rent_psf` (numeric); we project it into
 *     `Comp.lease_rate` so the rest of the codebase doesn't carry the
 *     DB column name.
 *   - There is no `deleted_at` column — this schema doesn't soft-
 *     delete. Filter dropped.
 */
const PROJECTION =
    "id, address, city, state, building_sf, land_area, sale_price, rent_psf, status, property_type, submarket_cluster, sub_market, sale_date, image_url";

interface CompsRow {
    id: string;
    address: string | null;
    city: string | null;
    state: string | null;
    building_sf: number | null;
    land_area: number | null;
    sale_price: number | null;
    rent_psf: number | null;
    status: string | null;
    property_type: string | null;
    submarket_cluster: string | null;
    sub_market: string | null;
    sale_date: string | null;
    image_url: string | null;
}

function rowToComp(r: CompsRow): Comp {
    return {
        id: r.id,
        address: r.address ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        building_sf: r.building_sf ?? 0,
        land_area: r.land_area ?? 0,
        sale_price: r.sale_price,
        lease_rate: r.rent_psf,
        status: r.status,
        property_type: r.property_type,
        submarket_cluster: r.submarket_cluster,
        sub_market: r.sub_market,
        sale_date: r.sale_date,
        image_url: r.image_url,
    };
}

export async function getComps(): Promise<Comp[]> {
    const { data, error } = await supabase
        .from("comps")
        .select(PROJECTION)
        .eq("internal_deal", true)
        .order("sale_date", { ascending: false, nullsFirst: false });

    if (error) {
        throw new Error(`Supabase comps fetch failed: ${error.message}`);
    }

    return (data as CompsRow[] | null)?.map(rowToComp) ?? [];
}
