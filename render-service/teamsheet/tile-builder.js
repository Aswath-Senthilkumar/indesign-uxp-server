/**
 * Per-tile bridge-payload builder. Single dispatch point for converting
 * comp data into the strings the bridge writes into named frames.
 *
 * Adding a new tile field = adding it to the manifest's `tile_fields[]`
 * AND adding a case below. The bridge code itself is field-agnostic
 * (see render-script.mjs).
 *
 * Known extension point: the switch in `resolveTileFieldValue()` is
 * hardcoded today (`address | city_state | sf_ac | price | status |
 * photo`). Phase 1 carries it over as-is; a manifest-driven resolver
 * is a future refactor.
 */

import {
    formatPriceLine,
    formatSfAc,
    formatStatusBadge,
} from "./format.js";

/**
 * Image fields are special-cased: the value is the pre-resolved local
 * filesystem path (or empty string when the comp has no usable image),
 * since the route owns image fetching/staging.
 *
 * @param {string} field
 * @param {object} comp        Comp shape (see lib/format.js)
 * @param {string} imagePath
 * @returns {string}
 */
export function resolveTileFieldValue(field, comp, imagePath) {
    switch (field) {
        case "address":
            return comp.address ?? "";
        case "city_state":
            return `${comp.city ?? ""}, ${comp.state ?? ""}`;
        case "sf_ac":
            return formatSfAc(comp.building_sf, comp.land_area);
        case "price":
            return formatPriceLine({
                sale_price: comp.sale_price,
                base_rent_total: comp.base_rent_total,
                lease_format: comp.lease_format,
            });
        case "status":
            return formatStatusBadge(comp.status);
        case "photo":
            return imagePath;
        default:
            throw new Error(
                `unknown tile field "${field}" — declared in manifest but no resolver in render-service/lib/tile-builder.js`
            );
    }
}

/**
 * Build the per-tile bridge payload from the manifest's tile_fields[]
 * declaration. Manifest order controls evaluation order; field name
 * controls the InDesign frame name (`tile_N_<key>`).
 *
 * @param {Array<{ field: string, type: 'text'|'image' }>} fieldDefs
 * @param {object} comp
 * @param {string} imagePath
 * @returns {Array<{ key: string, type: 'text'|'image', value: string }>}
 */
export function buildTileFields(fieldDefs, comp, imagePath) {
    return fieldDefs.map((fd) => ({
        key: fd.field,
        type: fd.type,
        value: resolveTileFieldValue(fd.field, comp, imagePath),
    }));
}
