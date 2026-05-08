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

### Frame verification probe

Sent against the bridge `/execute` endpoint with the new 18-tile
template as the active document. Probe iterates 18 tiles × 6 fields
(`tile_N_address`, `tile_N_city_state`, `tile_N_sf_ac`, `tile_N_price`,
`tile_N_status` as text frames; `tile_N_photo` as a rectangle), counts
the page-level frame instances, and lists any that fail `isValid`.

Iteration uses `everyItem().getElements()` to convert the
InDesign collection into a plain array (a first-pass probe with
`collection[i]` indexing failed at runtime — the `.everyItem()`
pattern is the safer one for UXP).

**First run:**

| | |
|---|---|
| Document | `18_Tile_Price_Status.indd` |
| Pages | 2 |
| `page_title` instances | 2 |
| `page_tagline` instances | 2 |
| Missing | `tile_2_city_state` |

User fixed the typo on `tile_2_city_state`.

**Second run:** all 108 expected frames (18×6 per-tile + 4 page-level)
resolved as valid. Cleared to proceed to 7.1.

---

## Stage 7.1 — Price-line rule

### Investigation

Queried Supabase against the live `comps` table to ground the rule in
real data shape, then cross-referenced page 1 of Hannah's existing
9-tile sample sheet (provided by the user as a screenshot).

#### Disclosure rates (281 internal-deal rows)

`sale_price` populated by status:

| Status | Total | With `sale_price` | Coverage |
|---|---|---|---|
| SOLD | 174 | 170 | 98% |
| FOR SALE | 27 | 27 | 100% |
| FOR SALE/LEASE | 8 | 7 | 88% |
| PENDING | 5 | 4 | 80% |
| LEASED | 35 | 0 | 0% |
| FOR LEASE | 28 | 0 | 0% |
| (null status) | 4 | 0 | 0% |

Lease-rate coverage on LEASED rows: 25/35 have `rent_psf`, **34/35
have `base_rent_total`** — `base_rent_total` is the broader column.

#### `base_rent_total` is monthly, not annual

Confirmed by cross-referencing one row from the screenshot:

- DB row: `411 S 33rd Avenue` LEASED, `base_rent_total = 32,375`,
  `lease_format = NNN`.
- Sheet shows `$32,000/MO NNN`.

`32,375 ≈ 32,000` only if the column is already monthly dollars.
That settles it; we do **not** divide by 12 in the formatter.

#### Sheet ↔ DB mismatches (important caveat)

The screenshot's tiles don't always cleanly map to a single DB row:

- `411 S 33rd Ave` — sheet shows `SOLD & FOR LEASE` /
  `$3,750,000 | $32,000/MO NNN`. DB has THREE separate rows for that
  address (SOLD $3.75M, LEASED with `base_rent_total=32,375`,
  FOR LEASE). The sheet merges them.
- `1313 N 25th Ave` — sheet shows `$6,500,000 | $55,000/MO NNN`. DB
  has a SOLD row at $6.5M plus a FOR LEASE row with **no disclosed
  rate**. The `$55,000/MO` figure is not in the DB.
- `234 E Mohave St` — sheet shows lease-only `$60,000 PER MONTH NNN`.
  DB only has a SOLD row at $5,025,000 with no lease data. The lease
  number is hand-typed, not from the DB.
- Three other tiles have small price/status discrepancies between
  sheet and DB (1441 N 27th, 30 N 56th, 1702 S 19th).

**Conclusion:** Hannah's existing sheets are hand-curated. The
dashboard's auto-render will produce results that match the DB
exactly, which by definition won't always match a sheet that's been
hand-edited or sourced externally. **One comp = one DB row** for v1.
Cross-row merging by address (and any per-tile manual override
workflow) is a real future feature; out of scope for Stage 7. User
acknowledged this gap.

### Price-line rule (`price_line_v1`)

Implemented as a pure function `formatPriceLine(comp)` in
`dashboard/lib/format.ts`. Evaluation order:

1. Both `sale_price` and `base_rent_total` populated →
   `$X,XXX,XXX | $X,XXX/MO [lease_format]`
   (e.g. `$3,750,000 | $32,000/MO NNN`)
2. Only `sale_price` populated →
   `$X,XXX,XXX` (e.g. `$4,650,000`)
3. Only `base_rent_total` populated →
   `$X,XXX/MO [lease_format]` (e.g. `$32,000/MO NNN`)
4. Neither →
   `Contact Broker`

Where `[lease_format]` is the row's `lease_format` value when
non-null, or omitted entirely when null.

`rent_psf` is **not used** by `formatPriceLine` — Hannah's sheets
quote monthly, not per-SF. `rent_psf` stays projected for any future
use but doesn't drive the v1 price line.

### Status badge transform (pending Max review)

Status frame text is the DB `status` value with a small transform
table. **The two transforms below were inferred from a single page
of one of Hannah's sample sheets — Max needs to confirm the
intended mapping for production.**

| DB `status` | Display | Inferred / verified? |
|---|---|---|
| `SOLD` | `SOLD` | verified (matches sample) |
| `FOR SALE` | `FOR SALE` | verified |
| `LEASED` | `LEASED` | not seen on the sample page; assumed identity |
| `FOR LEASE` | `FOR LEASE` | not seen alone on the sample page; assumed identity |
| `PENDING` | `PENDING SALE` | **inferred** — sample shows `PENDING SALE` badge but DB only has `PENDING`; need Max's confirmation |
| `FOR SALE/LEASE` | `SOLD & FOR LEASE` | **inferred** — sample tiles with this badge correspond to addresses that have multiple DB rows (one SOLD, one lease record) rather than the single-value `FOR SALE/LEASE` status. Max may want a different transform, or may want this to remain `FOR SALE/LEASE`. |
| NULL | (empty / no badge) | not seen; default to empty |

User decision on 2026-05-07: ship the inferred mapping for v1 and
flag for Max. Putting it in code lets a real render happen; the
mapping is one constant table, easily updated when Max responds.

### One screenshot artifact

The sample sheet's tile 6 (`1702 S 19th Ave`) shows a status badge
reading `F F F F F F F F` — almost certainly an authoring
placeholder Hannah forgot to populate, not a real data convention.
The DB row is plain `SOLD`. Ignored for rule design.

---

## Stage 7.2 — Manifest entry, render refactor, formatters

### Files

| Path | Status | Purpose |
|---|---|---|
| `dashboard/lib/format.ts` | modified | adds `formatPriceLine(inputs)` (price_line_v1) and `formatStatusBadge(status)` (status_badge_v1). `Comp` interface grew: `base_rent_total: number \| null`, `lease_format: string \| null`. |
| `dashboard/lib/comps.ts` | modified | projection adds `base_rent_total` and `lease_format`; `rowToComp` populates them. |
| `dashboard/lib/render-script.mjs` | rewritten | bridge code is now field-agnostic. Each tile carries `fields: [{ key, type, value }]`; the bridge dispatches on `type` (text → set contents; image → place + fit, OR clear and 20% grey fill when value is empty). Page overrides now fan out to **every** matching text frame in the document — multi-page templates get all copies updated. Result reports `appliedOverrides` as `{ frame, count }` so the caller can see fan-out. |
| `dashboard/app/api/render/route.ts` | refactored | new `resolveTileFieldValue(field, comp, imagePath)` is the single dispatch from manifest field name → string value. New `buildTileFields(fieldDefs, comp, imagePath)` walks `tpl.tile_fields` and produces the bridge payload. Header `X-Render-Applied-Overrides` now encodes `{frame:count}`. |
| `dashboard/templates/18_Tile_Price_Status/manifest.json` | new | id `18-tile-price-status`, label as user specified, `grid.cols: 3`, six tile_fields including `price` (rule `price_line_v1`) and `status` (rule `status_badge_v1`), two page_fields. |
| `dashboard/templates/18_Tile_Price_Status/render-mapping.ts` | new | canonical Comp → tile-payload declaration. Imports `formatPriceLine` and `formatStatusBadge` from `@/lib/format`. |
| `dashboard/templates/18_Tile_Price_Status/README.md` | new | template-specific notes (layout 3×3×2 pages, frame names, static frames, quirks). |

### Architecture notes

The bridge code in `render-script.mjs` no longer knows about specific
fields — it just iterates a per-tile array and dispatches on type.
This is the foundation that lets the remaining two templates
(`TeamBrochure_Airport.indd`, `TeamBrochure_NWPhoenix.indd`, both
field-identical to `18_Tile_Price_Status` per the user) integrate
with **just a manifest folder** and zero code changes.

The `resolveTileFieldValue()` switch in `route.ts` is the registry of
known field names. Adding a new field beyond the current six
(address/city_state/sf_ac/price/status/photo) means adding one case
there. The price-line rule and status badge transform are isolated as
pure functions in `dashboard/lib/format.ts`, easily updatable when
Max reviews the v1 transform table.

The 6_Tile_Defaults manifest declares only four tile_fields, so the
generic loop touches only those four frames per tile when rendering
that template — no spurious frame lookups. Backward compat preserved.

### First-render verification — cleared after a font fix

First end-to-end render of the new template surfaced visual
corruption on two specific frames: tile 1's status badge rendered
as `S S S S S S S S` instead of `SOLD & FOR LEASE`; tile 2's
address rendered as fragmented `S 4 5 5 S 4 5...` characters
instead of the real street address. Sibling frames on the same
tiles rendered cleanly.

**Root cause: missing fonts.** The user's system was missing
`EmojiOne` and `Avenir` (Light / Medium / Black / Heavy). Some
text frames in the template had been authored with those fonts,
so when the renderer set `frame.contents = value` the new text
inherited the missing font and InDesign's silent substitute
produced glyph garbage. `userInteractionLevel = neverInteract`
(set in the bridge code so the missing-font dialog doesn't wedge
the render) hides the warning, so the corruption only shows up in
the exported PDF.

**Resolution:** user re-typed the placeholder text in the
affected frames so the formatting reverted to an installed font;
re-saved the .indd; re-render came out clean.

**Implication for future templates:** before authoring a new
template, run `Type → Find Font…` on the .indd and resolve any
missing-font flags. If we ever ship to teammates with different
font sets, the cleanest fix is for the template to use a font
we package with the dashboard (or a system-default like Arial /
Helvetica) for the tile fields the renderer writes into. The
v1 dashboard doesn't manage fonts.

Stage 7.2 verification gate: cleared. ~20s wall time for a cold
18-tile render.

### Per-page distinct titles (post-7.2 follow-up)

User noticed during verification: the two pages of the 18-tile
template carry different titles (page 1's title is the "main"
heading, page 2's title is a secondary heading), but the tagline is
identical on both pages. The original manifest had a single
`page_title` field that fanned out to both pages — that overwrote
the page-2 title with the page-1 value.

Resolution: user renamed the InDesign frames to `page_1_title`
(page 1) and `page_2_title` (page 2). The probe confirmed:

```
page_title:    0 (old name removed)
page_1_title:  1 (page 1 only)
page_2_title:  1 (page 2 only)
page_tagline:  2 (one per page, fans out)
```

Manifest updated to declare three editable page_fields:
`page_1_title`, `page_2_title`, `tagline`. The dashboard's edit
page is fully data-driven from the manifest's page_fields (via
`/api/templates/[id]/page-fields`); the `humanize()` helper turns
`page_1_title` into the human label `Page 1 Title`. No code change
needed beyond the manifest — the page-fields endpoint and the edit
UI both pick up the new entries automatically.

The fan-out behavior in the bridge stays useful: `tagline →
page_tagline` matches both pages and updates them in sync;
`page_1_title` matches one frame (page 1) so only that page
updates, and likewise for `page_2_title`.

Generalizes naturally for future multi-page templates: shared
content uses one frame name across pages and gets fanned; per-page
content uses page-suffixed frame names and stays independent.

### Regression on 6-tile template

User verified after the manifest-driven render refactor: 6-tile
template renders identically to a Stage 6 PDF. Backward compat
preserved.
