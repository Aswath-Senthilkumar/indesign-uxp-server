/**
 * Shared types + formatters for the render flow.
 *
 * formatSfAc duplicates the formatter in `test-render.js`. The Stage 4
 * prompt asked us to share the helper, but the working notes also say
 * test-render.js is stable. A 5-line duplication is the smaller sin.
 */

export interface Comp {
    id: string;
    address: string;
    city: string;
    state: string;
    building_sf: number;
    land_area: number;
    image_filename: string;
}

export function formatSfAc(building_sf: number, land_area: number): string {
    const sf = building_sf.toLocaleString("en-US");
    const ac = land_area.toFixed(2);
    return `±${sf} SF | ±${ac} AC`;
}

export interface RenderRequest {
    template: string;
    comps: Comp[];
}

export interface ValidationError {
    field: string;
    message: string;
}

const REQUIRED_TEMPLATE = "template-v2-test";
const REQUIRED_COMPS = 6;
const COMP_FIELDS: Array<{ key: keyof Comp; type: "string" | "number" }> = [
    { key: "id", type: "string" },
    { key: "address", type: "string" },
    { key: "city", type: "string" },
    { key: "state", type: "string" },
    { key: "building_sf", type: "number" },
    { key: "land_area", type: "number" },
    { key: "image_filename", type: "string" },
];

export function validateRenderRequest(
    body: unknown
): { ok: true; request: RenderRequest } | { ok: false; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (typeof body !== "object" || body === null) {
        return { ok: false, errors: [{ field: "body", message: "expected JSON object" }] };
    }

    const b = body as Record<string, unknown>;

    if (typeof b.template !== "string") {
        errors.push({ field: "template", message: "expected string" });
    } else if (b.template !== REQUIRED_TEMPLATE) {
        errors.push({
            field: "template",
            message: `only "${REQUIRED_TEMPLATE}" is supported in v1`,
        });
    }

    if (!Array.isArray(b.comps)) {
        errors.push({ field: "comps", message: "expected array" });
        return { ok: false, errors };
    }

    if (b.comps.length !== REQUIRED_COMPS) {
        errors.push({
            field: "comps",
            message: `expected ${REQUIRED_COMPS} comps, got ${b.comps.length}`,
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

    if (errors.length > 0) return { ok: false, errors };

    return { ok: true, request: body as RenderRequest };
}
