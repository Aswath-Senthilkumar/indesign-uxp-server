# Recently_Leased_IOS

The first production template — six tiles in a 2-column × 3-row grid
with two editable page-level text frames (title, tagline). Drives the
"Recently Leased" sheet style.

## Tile layout

- 6 tiles total, arranged as **2 cols × 3 rows** in the source .indd.
- The dashboard's `/build/edit` drag-grid mirrors this via the manifest's
  `grid.cols = 2`. Don't increase the column count without the .indd
  changing first — the rendered PDF doesn't reflow when the dashboard
  grid does.

## Per-tile fields

Frames are named `tile_{N}_{field}` for `N = 1..6`:

| field        | type  | source on the Comp record                       |
|--------------|-------|-------------------------------------------------|
| `address`    | text  | `comp.address`                                  |
| `city_state` | text  | `${comp.city}, ${comp.state}`                   |
| `sf_ac`      | text  | `formatSfAc(comp.building_sf, comp.land_area)`  |
| `photo`      | image | `comp.image_url` (placed with `fillProportionally`; Track B fetches and caches the file before placement) |

The text mapping lives in [`render-mapping.ts`](./render-mapping.ts) as
the canonical declaration. Today the runtime is hardcoded to this same
shape — see the note in `render-mapping.ts`.

## Page-level fields

| field     | frame          | editable from dashboard? |
|-----------|----------------|--------------------------|
| `title`   | `page_title`   | yes                      |
| `tagline` | `page_tagline` | yes                      |

The dashboard sends overrides only for editable fields, and only when
the user typed a non-empty value. An untouched page field renders the
.indd default unchanged.

## Static frames (managed in InDesign)

Not surfaced anywhere in the dashboard — Hannah edits these in InDesign
directly. Listed here so a future engineer doesn't mistake them for
unwired-up dashboard fields:

- Agent name plates: `patrick_sior`, `max_sior`
- Contact lines: `jack_contact`, `patrick_contact`, `max_contact`
- Branding: `logo`, `company_info`, `declaration`
- Decorative `*_frame` shapes
- Per-tile background frames named `tile_N` (the tile rectangles
  themselves, distinct from `tile_N_photo` which is the photo
  placeholder)

## Adding a comp manually (CLI)

The standalone `test-render.js` at the repo root pre-dates the dashboard
and is wired to its own mock-data list. It carries its own `formatSfAc`
copy because it runs without the dashboard's TypeScript build. If you
edit the SF/AC format, change both that copy and `dashboard/lib/format.ts`.

## Quirks

- The `±` glyph in `sf_ac` requires a font that has it. The template's
  default font does; if you swap it, verify in InDesign before
  re-exporting.
- Acres render as 2-decimal-place values (e.g. `±133.00 AC`). Hannah
  hasn't asked for integer-acre rendering yet — if she does, change
  `formatSfAc` in `dashboard/lib/format.ts`.
