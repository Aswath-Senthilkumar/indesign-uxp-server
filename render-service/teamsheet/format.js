/**
 * Comp type doc + shared formatters for the render path.
 *
 * Mirrors dashboard/lib/format.ts. Kept in sync by hand for Phase 1;
 * the dashboard's copy is still used by its picker/edit UI components.
 *
 * Comp shape (documentation only — plain JS):
 *   id              string (required)
 *   address         string (required, may be "")
 *   city            string
 *   state           string
 *   building_sf     number
 *   land_area       number
 *   image_url       string | null
 *   property_name   string | null
 *   sale_price      number | null
 *   lease_rate      number | null    (DB column: rent_psf)
 *   base_rent_total number | null
 *   lease_format    string | null
 *   status          string | null
 *   property_type   string | null
 *   submarket_cluster string | null
 *   sub_market      string | null
 *   sale_date       string | null
 */

export function formatSfAc(building_sf, land_area) {
    const sf = (building_sf ?? 0).toLocaleString("en-US");
    const ac = (land_area ?? 0).toFixed(2);
    return `±${sf} SF | ±${ac} AC`;
}

function formatSale(n) {
    return `$${Math.round(n).toLocaleString("en-US")}`;
}

function formatMonthly(n, leaseFormat) {
    const base = `$${Math.round(n).toLocaleString("en-US")}/MO`;
    return leaseFormat ? `${base} ${leaseFormat}` : base;
}

/**
 * price_line_v1 evaluation order:
 *   1. sale_price + base_rent_total -> "$X,XXX,XXX | $X,XXX/MO [lf]"
 *   2. sale_price only               -> "$X,XXX,XXX"
 *   3. base_rent_total only          -> "$X,XXX/MO [lf]"
 *   4. neither                       -> "Contact Broker"
 */
export function formatPriceLine({ sale_price, base_rent_total, lease_format }) {
    const hasSale = sale_price !== null && sale_price !== undefined;
    const hasLease = base_rent_total !== null && base_rent_total !== undefined;
    if (hasSale && hasLease) {
        return `${formatSale(sale_price)} | ${formatMonthly(base_rent_total, lease_format)}`;
    }
    if (hasSale) return formatSale(sale_price);
    if (hasLease) return formatMonthly(base_rent_total, lease_format);
    return "Contact Broker";
}

// PENDING -> "PENDING SALE" and FOR SALE/LEASE -> "SOLD & FOR LEASE"
// are inferred from a sample sheet; production mapping needs confirmation.
const STATUS_BADGE_MAP = {
    SOLD: "SOLD",
    "FOR SALE": "FOR SALE",
    LEASED: "LEASED",
    "FOR LEASE": "FOR LEASE",
    PENDING: "PENDING SALE",
    "FOR SALE/LEASE": "SOLD & FOR LEASE",
};

export function formatStatusBadge(status) {
    if (status === null || status === undefined) return "";
    return STATUS_BADGE_MAP[status] ?? status;
}
