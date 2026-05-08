# Stage 7 — Integrate one additional 18-tile template

Stage 6 left the dashboard with one production template (the original
`Recently_Leased_IOS`, a 6-tile layout) plumbed to live Supabase data.
Stage 7 adds a second template (`18_Tile_Price_Status`) that introduces
two new per-tile fields — `tile_N_price` and `tile_N_status` — and a
2-page page-level structure where `page_title` and `page_tagline` each
appear twice (once per page) and both copies must be updated when the
broker edits them.

Three structurally identical 18-tile templates are coming; we're
integrating one in this stage to prove the pattern. The other two come
along the same path with minimal additional work.

## Stage 7.0 — Template metadata

### Existing-template rename

Decided alongside the new-template intake. The original
`Recently_Leased_IOS` template / `recently-leased-ios` id was specific
to one sheet style, but the codebase needs a naming convention that
generalizes across the multi-template set. Renamed:

| | Before | After |
|---|---|---|
| `.indd` filename | `templates/Recently_Leased_IOS.indd` | `templates/6_Tile_Defaults.indd` |
| Per-template folder | `dashboard/templates/Recently_Leased_IOS/` | `dashboard/templates/6_Tile_Defaults/` |
| Manifest `id` | `recently-leased-ios` | `6-tile-defaults` |
| Manifest `label` | `Recently Leased IOS` | `6 Tiles template with defaults` |

User renamed the `.indd` on disk; folder rename done with `git mv` so
history is preserved. Updated:

- `dashboard/templates/6_Tile_Defaults/manifest.json` — id, label, file
- `dashboard/templates/6_Tile_Defaults/README.md` — header + note that
  the original name was Recently_Leased_IOS
- `dashboard/templates/6_Tile_Defaults/render-mapping.ts` — comment
- `dashboard/components/picker.tsx` — legacy hard-coded `template_id`
  used by the `/legacy` flow
- `dashboard/components/edit-render.tsx` — comment
- `dashboard/templates/README.md` — convention guide references

`STAGE-5-NOTES.md` and `STAGE-6-NOTES.md` are historical records and
intentionally NOT retroactively updated; they describe the codebase as
it was at the time. Anyone reading them and confused by the old names
should land here.

### New template metadata

| | |
|---|---|
| `.indd` filename | `templates/18_Tile_Price_Status.indd` |
| Manifest `id` | `18-tile-price-status` |
| Manifest `label` | `18 Tiles Template with defaults along with Price and Status fields` |
| Tile count | 18 |
| Pages | 2 (both pages contain `page_title` and `page_tagline`; both must update when broker edits) |

Per-tile frames declared by the user:

| Tile field | Frame name |
|---|---|
| address | `tile_N_address` (text) |
| city_state | `tile_N_city_state` (text) |
| sf_ac | `tile_N_sf_ac` (text) |
| photo | `tile_N_photo` (rectangle) |
| price | `tile_N_price` (text) — **new** |
| status | `tile_N_status` (text) — **new** |

Page-level frames: `page_title` (text), `page_tagline` (text).
Each appears once on page 1 and once on page 2; the bridge needs to
update **both** when the broker edits.

Static frames similar to the 6-tile template: agent name plates,
contact lines, branding, decorative shapes, tile background rects.

### The other two templates

User confirmed the remaining two are field-identical to this one
(same six tile fields, same 18-tile layout). Once the manifest-driven
render refactor lands in Stage 7.2, those will integrate as a manifest
entry + per-template folder with no code changes.

### Multi-page page-level overrides — bridge change required

Today the bridge does `doc.textFrames.itemByName(name)` for page
overrides. That returns only the first matching frame, so on a 2-page
template only one of the two `page_title` instances would update. The
Stage 7.2 manifest-driven refactor will iterate `doc.textFrames` and
apply the override to **every** matching frame by name, which works
generically for any multi-page template.
