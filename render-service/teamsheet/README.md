# render-service/teamsheet

Team-sheet workflow. Takes an ordered list of Supabase comp IDs, resolves each to a tile of fields, and renders a multi-tile InDesign template to PDF.

## Request shape (POST /render)

```json
{
  "template_id": "6-tile-defaults",
  "comp_ids": ["uuid-1", "uuid-2", "uuid-3", "uuid-4", "uuid-5", "uuid-6"],
  "page_overrides": { "title": "Recently Leased", "tagline": "Phoenix, AZ" },
  "tile_overrides": {
    "uuid-1": { "address": "Custom Address Override" }
  }
}
```

- `comp_ids` is **ordered** — tile N is populated from `comp_ids[N-1]`
- `comp_ids.length` must equal the template's `tile_count`
- `page_overrides` is keyed by manifest `page_fields[].field`
- `tile_overrides` is sparse and optional — absent means "use Supabase data as-is"

## Pipeline (`render-pipeline.js`)

```
1. resolveTemplatePath(manifest)        → absolute .indd path
2. Load comp rows from Supabase          → comp objects by id
3. Validate comp count, override keys    → 400 if invalid
4. Fetch + stage images                  → local paths (5-min cache)
5. Build per-tile field objects          → tile-builder.js
6. Apply tile_overrides                  → merge-overrides.js
7. Apply page_overrides                  → fan-out to frame names
8. Generate bridge JS string             → core/render-script.mjs
9. bridgeExecute(code)                   → InDesign renders
10. exportFile → PDF bytes               → returned to caller
```

Timing is tracked at each step and returned via `X-Render-*` response headers.

## Files

| File | Purpose |
|------|---------|
| `render-pipeline.js` | Orchestration — runs all 10 pipeline steps |
| `tile-builder.js` | `resolveTileFieldValue(field, comp)` — dispatches on field type to produce the final string or image path for each tile frame |
| `format.js` | `formatSfAc`, `formatPriceLine`, `formatStatusBadge` — pure formatting functions used by tile-builder |
| `validate.js` | Request validation: comp count, override field whitelist, override field types |
| `merge-overrides.js` | Shallow-merges `tile_overrides` map onto Supabase comp rows before the pipeline sees them |

## Routes

| Method | Path | File | Notes |
|--------|------|------|-------|
| `POST` | `/introspect` | `routes/introspect.js` | Returns tile count, grid cols, field names |
| `GET` | `/page-fields` | `routes/page-fields.js` | Returns editable page field current values |
| `POST` | `/render` | `routes/render.js` | Main render endpoint |

Full endpoint contracts (request/response shapes, error codes, response headers) are in [`render-service/README.md`](../README.md).

## Tile field types

| Type | Frame pattern | Description |
|------|--------------|-------------|
| `text` | `tile_{N}_{field}` | Direct string, InDesign clips if it overflows |
| `image` | `tile_{N}_photo` | Image fetched from URL, staged locally, placed + `fillProportionally` |
| `sf_ac` | `tile_{N}_sf_ac` | `formatSfAc(building_sf, land_area)` → `±14,350 SF on ±1.88 AC` |
| `price_line_v1` | `tile_{N}_price` | `formatPriceLine(comp)` — handles sale-only, lease-only, dual |
| `status_badge_v1` | `tile_{N}_status` | `formatStatusBadge(status)` — e.g. `"PENDING"` → `"PENDING SALE"` |

## Tile override semantics

`tile_overrides` is a sparse map keyed by `comp_id`. Each value is shallow-merged over the Supabase comp row before the tile is built. The merged object flows through the existing formatters unchanged — there is no separate override pipeline. Only the fields in `validate.js`'s whitelist are accepted; anything else returns a `400`.

## Adding a new tile field type

1. Add the field to the template's `.indd` using the naming pattern `tile_{N}_{fieldName}`
2. Add the field to `manifest.json` `tile_fields` array with the correct `type`
3. If the type is new, add a case to `tile-builder.js`'s `resolveTileFieldValue` switch and a formatter to `format.js` if needed
4. Add the field to the override whitelist in `validate.js` if overrides should be supported
