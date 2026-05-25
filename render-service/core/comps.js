/**
 * Comp data layer.
 *
 * Scope: SELECT only. No mutations.
 *
 * Schema notes (verified against information_schema):
 *   - There is no `lease_rate` column. The CRE-equivalent per-sqft
 *     annual figure is `rent_psf` (numeric); we project it into
 *     Comp.lease_rate so the rest of the codebase doesn't carry the
 *     DB column name.
 *   - There is no `deleted_at` column — this schema doesn't soft-delete.
 *
 * Many live rows have null `image_url`; the render path treats null
 * image_url and image fetch failures the same way (grey placeholder).
 */

import { supabase } from "./supabase.js";

const PROJECTION =
    "id, address, city, state, building_sf, land_area, sale_price, rent_psf, base_rent_total, lease_format, status, property_type, submarket_cluster, sub_market, sale_date, image_url, property_name";

function rowToComp(r) {
    return {
        id: r.id,
        address: r.address ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        building_sf: r.building_sf ?? 0,
        land_area: r.land_area ?? 0,
        sale_price: r.sale_price,
        lease_rate: r.rent_psf,
        base_rent_total: r.base_rent_total,
        lease_format: r.lease_format,
        status: r.status,
        property_type: r.property_type,
        submarket_cluster: r.submarket_cluster,
        sub_market: r.sub_market,
        sale_date: r.sale_date,
        image_url: r.image_url,
        property_name: r.property_name,
    };
}

/**
 * Fetch all internal comps, newest-first.
 * Currently unused by the service routes (the new contract is comp_ids
 * only) but kept for parity with the dashboard data layer and potential
 * admin/debug endpoints.
 */
export async function getComps() {
    const { data, error } = await supabase
        .from("comps")
        .select(PROJECTION)
        .eq("internal_deal", true)
        .order("sale_date", { ascending: false, nullsFirst: false });

    if (error) {
        throw new Error(`Supabase comps fetch failed: ${error.message}`);
    }

    return (data ?? []).map(rowToComp);
}

/**
 * Fetch a set of comps by id. Returns `{ comps, missing }` where:
 *   - `comps` preserves the order of `ids` (so callers can directly
 *     index tile_N = comps[N-1]).
 *   - `missing` lists the ids that had no row in the table.
 *
 * Does NOT throw on missing ids — the route surfaces them as a 4xx.
 */
export async function getCompsByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
        return { comps: [], missing: [] };
    }
    const { data, error } = await supabase
        .from("comps")
        .select(PROJECTION)
        .in("id", ids);

    if (error) {
        throw new Error(`Supabase comps fetch failed: ${error.message}`);
    }

    const byId = new Map();
    for (const row of data ?? []) byId.set(row.id, rowToComp(row));

    const comps = [];
    const missing = [];
    for (const id of ids) {
        const c = byId.get(id);
        if (c) comps.push(c);
        else missing.push(id);
    }
    return { comps, missing };
}
