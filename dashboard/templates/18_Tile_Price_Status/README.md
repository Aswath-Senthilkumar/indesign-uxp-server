# 18_Tile_Price_Status

Stage 7 template. 18 tiles split across 2 pages (3 cols × 3 rows per
page) with two new per-tile fields beyond the 6_Tile_Defaults set:
`price` and `status`. Two structurally identical sibling templates
(`TeamBrochure_Airport.indd`, `TeamBrochure_NWPhoenix.indd`) follow
the same shape and integrate by adding a manifest folder — no further
code changes.

## Tile layout

- 18 tiles total, arranged as **3 cols × 3 rows × 2 pages** in the
  source .indd.
- The dashboard's `/build/edit` drag-grid is `grid.cols = 3`,
  yielding a 3 × 6 vertical layout that mirrors the per-page
  composition of the .indd.

## Per-tile fields

Frames are named `tile_{N}_{field}` for `N = 1..18`:

| field        | type  | source on the Comp record |
|--------------|-------|---------------------------|
| `address`    | text  | `comp.address` |
| `city_state` | text  | `${comp.city}, ${comp.state}` |
| `sf_ac`      | text  | `formatSfAc(comp.building_sf, comp.land_area)` |
| `price`      | text  | `formatPriceLine({sale_price, base_rent_total, lease_format})` (Stage 7.1 rule, see [STAGE-7-NOTES.md](../../../STAGE-7-NOTES.md)) |
| `status`     | text  | `formatStatusBadge(comp.status)` (Stage 7.1 transform table) |
| `photo`      | image | `comp.image_url` (placed with `fillProportionally`; Track B fetches and caches the file before placement) |

The text mapping lives in [`render-mapping.ts`](./render-mapping.ts) as
the canonical declaration; the runtime dispatch lives in
[`dashboard/app/api/render/route.ts`](../../../dashboard/app/api/render/route.ts)
in `resolveTileFieldValue()`. Keep them in sync.

## Page-level fields

Each frame appears once on page 1 and once on page 2. The bridge
applies overrides to **all** matching frames in the document, so a
single edit on the dashboard updates both pages.

| field     | frame          | editable from dashboard? |
|-----------|----------------|--------------------------|
| `title`   | `page_title`   | yes |
| `tagline` | `page_tagline` | yes |

## Static frames (managed in InDesign)

Not surfaced in the dashboard. Listed for the next reader:

- Agent name plates, contact lines, branding/logo
- Decorative `*_frame` shapes
- Per-tile background rects named `tile_N` (the rectangles behind the
  content; distinct from `tile_N_photo` which is the photo placeholder
  inside)

## Quirks

- `tile_2_city_state` was missing/misnamed on the first authoring
  pass; the Stage 7.0 frame-verification probe caught it and the user
  fixed it before the first render attempt. If you author a new
  18-tile template from scratch, run the probe first to catch this
  class of typo.
- The `±` glyph in `sf_ac` requires a font that has it. The template's
  default font does; if you swap fonts, verify in InDesign before
  re-exporting.
- `formatPriceLine` and `formatStatusBadge` have edge cases that
  may need iteration after Max reviews the inferred status badge
  transforms (`PENDING → "PENDING SALE"`, `FOR SALE/LEASE → "SOLD &
  FOR LEASE"`). See STAGE-7-NOTES.md.
