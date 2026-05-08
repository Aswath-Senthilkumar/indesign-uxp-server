/**
 * Shared types + formatters for the render flow.
 *
 * formatSfAc duplicates the formatter in `test-render.js`. The Stage 4
 * prompt asked us to share the helper, but the working notes also say
 * test-render.js is stable. A 5-line duplication is the smaller sin.
 *
 * Stage 6: Comp grew from the v1 mock-data shape (id, address, city,
 * state, building_sf, land_area, image_filename) to the live Supabase
 * shape. `image_filename` is gone — replaced by `image_url` which is a
 * fully-qualified public bucket URL, nullable. The remaining new
 * fields are nullable to reflect the messier real-world data.
 */

export interface Comp {
    id: string;
    address: string;
    city: string;
    state: string;
    building_sf: number;
    land_area: number;
    image_url: string | null;
    property_name: string | null;
    sale_price: number | null;
    lease_rate: number | null;
    base_rent_total: number | null;
    lease_format: string | null;
    status: string | null;
    property_type: string | null;
    submarket_cluster: string | null;
    sub_market: string | null;
    sale_date: string | null;
}

export function formatSfAc(building_sf: number, land_area: number): string {
    const sf = building_sf.toLocaleString("en-US");
    const ac = land_area.toFixed(2);
    return `±${sf} SF | ±${ac} AC`;
}

/*
 * Stage 7.1 price-line rule (price_line_v1). See STAGE-7-NOTES.md
 * "Stage 7.1 — Price-line rule" for the data investigation that
 * grounds these choices.
 *
 * Evaluation order:
 *   1. sale_price + base_rent_total -> "$X,XXX,XXX | $X,XXX/MO [lf]"
 *   2. sale_price only               -> "$X,XXX,XXX"
 *   3. base_rent_total only          -> "$X,XXX/MO [lf]"
 *   4. neither                       -> "Contact Broker"
 *
 * `[lf]` is the row's `lease_format` value when non-null, otherwise
 * omitted entirely (no trailing space).
 *
 * `base_rent_total` is monthly dollars (verified against sample data:
 * 411 S 33rd Ave row has base_rent_total=32,375 and Hannah's existing
 * sheet renders it as "$32,000/MO NNN"). Do NOT divide by 12.
 *
 * `rent_psf` is intentionally not used by this formatter — Hannah's
 * sheets quote monthly, not per-SF. The column is still projected in
 * `Comp` for future use but doesn't drive the v1 price line.
 */
export interface PriceLineInputs {
    sale_price: number | null;
    base_rent_total: number | null;
    lease_format: string | null;
}

function formatSale(n: number): string {
    return `$${Math.round(n).toLocaleString("en-US")}`;
}

function formatMonthly(n: number, leaseFormat: string | null): string {
    const base = `$${Math.round(n).toLocaleString("en-US")}/MO`;
    return leaseFormat ? `${base} ${leaseFormat}` : base;
}

export function formatPriceLine(inputs: PriceLineInputs): string {
    const { sale_price, base_rent_total, lease_format } = inputs;
    const hasSale = sale_price !== null;
    const hasLease = base_rent_total !== null;
    if (hasSale && hasLease) {
        return `${formatSale(sale_price)} | ${formatMonthly(base_rent_total, lease_format)}`;
    }
    if (hasSale) return formatSale(sale_price);
    if (hasLease) return formatMonthly(base_rent_total, lease_format);
    return "Contact Broker";
}

/*
 * Stage 7.1 status badge transform. The DB has 7 distinct values
 * (six strings + null); the existing sheets show slightly different
 * text for two of them. PENDING -> "PENDING SALE" and FOR SALE/LEASE
 * -> "SOLD & FOR LEASE" are inferred from one screenshot of Hannah's
 * sample sheet — Max needs to confirm production mapping. The other
 * five are identity / empty.
 *
 * Update this table when Max responds.
 */
const STATUS_BADGE_MAP: Record<string, string> = {
    SOLD: "SOLD",
    "FOR SALE": "FOR SALE",
    LEASED: "LEASED",
    "FOR LEASE": "FOR LEASE",
    PENDING: "PENDING SALE",
    "FOR SALE/LEASE": "SOLD & FOR LEASE",
};

export function formatStatusBadge(status: string | null): string {
    if (status === null) return "";
    return STATUS_BADGE_MAP[status] ?? status;
}

export interface RenderRequest {
    template_id: string;
    comps: Comp[];
    page_overrides?: Record<string, string>;
    /**
     * tile_count is required so the server can validate the comps array
     * without re-querying the bridge. The client carries it from the
     * introspection cache.
     */
    tile_count: number;
}

export interface ValidationError {
    field: string;
    message: string;
}

// Render-request validator only checks the fields the renderer actually
// reads. Image handling is separate (Track B): image_url may be null
// and the render path decides what to do per the missing-image policy.
const COMP_FIELDS: Array<{ key: keyof Comp; type: "string" | "number" }> = [
    { key: "id", type: "string" },
    { key: "address", type: "string" },
    { key: "city", type: "string" },
    { key: "state", type: "string" },
    { key: "building_sf", type: "number" },
    { key: "land_area", type: "number" },
];

export function validateRenderRequest(
    body: unknown
): { ok: true; request: RenderRequest } | { ok: false; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (typeof body !== "object" || body === null) {
        return { ok: false, errors: [{ field: "body", message: "expected JSON object" }] };
    }

    const b = body as Record<string, unknown>;

    if (typeof b.template_id !== "string" || b.template_id.length === 0) {
        errors.push({ field: "template_id", message: "expected non-empty string" });
    }

    if (typeof b.tile_count !== "number" || !Number.isInteger(b.tile_count) || b.tile_count <= 0) {
        errors.push({ field: "tile_count", message: "expected positive integer" });
    }

    if (!Array.isArray(b.comps)) {
        errors.push({ field: "comps", message: "expected array" });
        return { ok: false, errors };
    }

    const requiredComps = typeof b.tile_count === "number" ? b.tile_count : null;
    if (requiredComps !== null && b.comps.length !== requiredComps) {
        errors.push({
            field: "comps",
            message: `expected ${requiredComps} comps (per tile_count), got ${b.comps.length}`,
        });
    }

    b.comps.forEach((comp, i) => {
        if (typeof comp !== "object" || comp === null) {
            errors.push({ field: `comps[${i}]`, message: "expected object" });
            return;
        }
        const c = comp as Record<string, unknown>;
        for (const { key, type } of COMP_FIELDS) {
            const v = c[key];
            if (v === undefined || v === null) {
                errors.push({ field: `comps[${i}].${key}`, message: "missing" });
            } else if (typeof v !== type) {
                errors.push({
                    field: `comps[${i}].${key}`,
                    message: `expected ${type}, got ${typeof v}`,
                });
            }
        }
    });

    // page_overrides is optional. When present, must be a plain string-keyed,
    // string-valued map (the client may also send omitted/empty values which
    // we accept as no-override).
    if (b.page_overrides !== undefined && b.page_overrides !== null) {
        if (typeof b.page_overrides !== "object" || Array.isArray(b.page_overrides)) {
            errors.push({ field: "page_overrides", message: "expected object" });
        } else {
            for (const [k, v] of Object.entries(b.page_overrides as Record<string, unknown>)) {
                if (typeof v !== "string") {
                    errors.push({
                        field: `page_overrides.${k}`,
                        message: `expected string, got ${typeof v}`,
                    });
                }
            }
        }
    }

    if (errors.length > 0) return { ok: false, errors };

    return { ok: true, request: body as RenderRequest };
}
