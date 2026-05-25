/**
 * Sparse-merge per-tile overrides on top of comp rows read from Supabase.
 *
 * Phase 3 contract addition: the caller may pass `tile_overrides`, a
 * sparse object keyed by `comp_id` containing per-comp field overrides
 * (e.g. a corrected address, a different photo url) for one render
 * only — without mutating the underlying Supabase `comps` row.
 *
 * Semantics (matches the contract in
 * master-app/prompts/render-service-tile-overrides.md):
 *   - Override on top of comp: shallow Object.assign, override wins.
 *   - `undefined` field values mean "no override". `null` is a real
 *     override value (e.g. clear the price line).
 *   - One override per unique comp_id. If comp_ids[] contains the same
 *     id more than once, every occurrence receives the same merged
 *     comp; the response header reports the count once per comp_id.
 *   - Empty per-comp map `{}` is valid input but contributes nothing
 *     (count 0, no header entry). Matches the master-app UI race where
 *     the override modal initializes an empty record on open.
 *   - The merged object keeps the Comp shape — downstream formatters
 *     and the tile-field dispatch see "a comp that happens to have
 *     those values", no per-template logic.
 *
 * Returns:
 *   {
 *     mergedComps: Comp[]                 // same length / order as `comps`
 *     overrideApplied: Map<comp_id, n>    // only entries with n > 0
 *   }
 *
 * Note: the validator (lib/validate.js) already rejected unknown
 * override keys and wrong field types, so this function trusts its
 * input shape.
 */

export function mergeTileOverrides(comps, tileOverrides) {
    const overrides = tileOverrides ?? {};
    const overrideApplied = new Map();

    const mergedComps = comps.map((c) => {
        const ov = overrides[c.id];
        if (!ov) return c;

        let count = 0;
        const merged = { ...c };
        for (const [k, v] of Object.entries(ov)) {
            // `undefined` is the JS-side absent signal. `null` is a real
            // override value (e.g. clearing a price column) and IS
            // counted as applied.
            if (v === undefined) continue;
            merged[k] = v;
            count++;
        }

        // Only surface counts > 0. Empty per-comp `{}` passes validation
        // but doesn't contribute to the response header.
        if (count > 0) overrideApplied.set(c.id, count);
        return merged;
    });

    return { mergedComps, overrideApplied };
}
