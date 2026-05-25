/**
 * Render-request validators for the comp_ids-only contract.
 *
 * Returns `{ ok: true, request }` or `{ ok: false, errors: [...] }`.
 * Templates and comp-id existence are validated downstream against the
 * manifest registry and Supabase — this only checks shape.
 */

/**
 * Phase 3 tile-overrides whitelist. The set of fields a caller can
 * shadow on a per-comp basis for one render. Locked to fields that
 * flow into a rendered tile_field today; unknown keys reject so a typo
 * surfaces loudly instead of silently no-op'ing.
 *
 * Value type table:
 *   - "string": accepts string or null
 *   - "number": accepts number or null
 */
const TILE_OVERRIDE_FIELDS = {
    address: "string",
    city: "string",
    state: "string",
    lease_format: "string",
    status: "string",
    image_url: "string",
    building_sf: "number",
    land_area: "number",
    sale_price: "number",
    base_rent_total: "number",
};

export function validateRenderRequest(body) {
    const errors = [];

    if (typeof body !== "object" || body === null) {
        return {
            ok: false,
            errors: [{ field: "body", message: "expected JSON object" }],
        };
    }

    const b = body;

    if (typeof b.template_id !== "string" || b.template_id.length === 0) {
        errors.push({
            field: "template_id",
            message: "expected non-empty string",
        });
    }

    if (!Array.isArray(b.comp_ids)) {
        errors.push({ field: "comp_ids", message: "expected array of strings" });
    } else if (b.comp_ids.length === 0) {
        errors.push({ field: "comp_ids", message: "expected non-empty array" });
    } else {
        b.comp_ids.forEach((id, i) => {
            if (typeof id !== "string" || id.length === 0) {
                errors.push({
                    field: `comp_ids[${i}]`,
                    message: "expected non-empty string",
                });
            }
        });
    }

    if (b.page_overrides !== undefined && b.page_overrides !== null) {
        if (typeof b.page_overrides !== "object" || Array.isArray(b.page_overrides)) {
            errors.push({
                field: "page_overrides",
                message: "expected object with string values",
            });
        } else {
            for (const [k, v] of Object.entries(b.page_overrides)) {
                if (typeof v !== "string") {
                    errors.push({
                        field: `page_overrides.${k}`,
                        message: `expected string, got ${typeof v}`,
                    });
                }
            }
        }
    }

    // tile_overrides (Phase 3, optional). Sparse map keyed by comp_id;
    // unknown override keys are hard-errored so a typo (e.g. `pricee`)
    // doesn't silently render with the original comp's price. Empty
    // top-level map and empty per-comp map are both no-ops and pass
    // through to a no-op merge at pipeline time.
    if (b.tile_overrides !== undefined && b.tile_overrides !== null) {
        const t = b.tile_overrides;
        if (typeof t !== "object" || Array.isArray(t)) {
            errors.push({
                field: "tile_overrides",
                message: "expected object keyed by comp_id",
            });
        } else {
            const compIdSet = new Set(
                Array.isArray(b.comp_ids)
                    ? b.comp_ids.filter((x) => typeof x === "string")
                    : []
            );
            for (const [compId, override] of Object.entries(t)) {
                // Match comp_ids[]'s opaque-string treatment: don't enforce
                // UUID shape here. A malformed id will fail at the same
                // Supabase round-trip a malformed comp_ids entry would.
                if (!compIdSet.has(compId)) {
                    errors.push({
                        field: `tile_overrides.${compId}`,
                        message: "comp_id not in comp_ids[]",
                    });
                    continue;
                }
                if (
                    typeof override !== "object" ||
                    override === null ||
                    Array.isArray(override)
                ) {
                    errors.push({
                        field: `tile_overrides.${compId}`,
                        message: "expected object",
                    });
                    continue;
                }
                for (const [field, value] of Object.entries(override)) {
                    const expected = TILE_OVERRIDE_FIELDS[field];
                    if (!expected) {
                        errors.push({
                            field: `tile_overrides.${compId}.${field}`,
                            message: "unknown override key",
                        });
                        continue;
                    }
                    if (value === null || value === undefined) continue;
                    if (typeof value !== expected) {
                        errors.push({
                            field: `tile_overrides.${compId}.${field}`,
                            message: `expected ${expected} or null, got ${typeof value}`,
                        });
                    }
                }
            }
        }
    }

    if (errors.length > 0) return { ok: false, errors };

    return {
        ok: true,
        request: {
            template_id: b.template_id,
            comp_ids: b.comp_ids,
            page_overrides: b.page_overrides ?? {},
            tile_overrides: b.tile_overrides ?? {},
        },
    };
}
