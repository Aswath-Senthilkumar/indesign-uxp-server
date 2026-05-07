# Stage 6 — Supabase integration for live comps data

Stage 5 produced a working dashboard rendering team sheets from
mock-data/comps.json (7 hand-picked entries). Stage 6 swaps the data
layer for a live Supabase connection to RGCRE's `comps` table
(~630 rows total, **281 with `internal_deal = true`** — the prompt's
"~137" estimate was stale; verified live count is 281). Bridge, plugin,
and the InDesign template stay untouched — Stage 6 is dashboard-and-
render-API work only.

Tracks:
- **Track A** (6.1) — Supabase client + live data in the picker
- **Track B** (6.2) — image fetching and per-render disk handling
- **Track C** (6.3) — picker UI for ~137-row data set

## Stage 6.0 — Connection details

### Supabase project

- URL: `https://kavynghiailoduhulytq.supabase.co`
- Anon key: stored in `dashboard/.env.local` (gitignored via the
  Next.js default `.env*` rule). Service-role key is held by the user
  but **not** used here — read-only scope is the explicit constraint.

### Read-only scope

User confirmed the project's intent: select-only on `comps`, no
writes. The DB is shared with other projects so any write from here
would be a real problem. **Implementation enforces this two ways:**

1. Anon key only (no service-role key in env).
2. All Supabase calls are `.select()` — no `.insert()/.update()/.delete()`
   anywhere in the codebase.

The user has not separately confirmed the RLS policy view in the
Supabase dashboard. Worth verifying once we hit a natural pause; the
two enforcement layers above are sufficient for the prototype but the
RLS view is the belt to our braces.

### `image_url` shape

Full URLs in the `https://kavynghiailoduhulytq.supabase.co/storage/v1/object/public/comp-images/<filename>.jpg`
form. Verified by inspecting ten consecutive rows in the table editor.
**Many rows are NULL** — out of the 10 sampled, 6 were NULL. This is a
real data-quality issue that drives Track B's missing-image handling
and Track C's visual flag.

### Bucket access

Public bucket. An image URL opened in an incognito window loads
without auth — no signed URLs needed. Track B can fetch directly.

### `internal_deal`

Boolean column. Filter is `internal_deal = true`.

### `status` distinct values (where internal_deal = true)

```
FOR LEASE
FOR SALE
FOR SALE/LEASE
LEASED
PENDING
SOLD
NULL
```

Seven distinct values including NULL. Track C's status filter will be
multi-select; NULL handled as its own option.

### `submarket_cluster` distinct values (where internal_deal = true)

```
Airport/South Central
Deer Valley/North Phoenix
Far East Valley
Far West Valley
Pinal County
Scottsdale
Southeast Valley
Southwest Phoenix/Tolleson
Tempe
West Phoenix/Grand Ave
NULL
```

Eleven distinct values including NULL. All Phoenix-metro submarkets.
Track C's submarket filter will be a single-select dropdown.

---

## Stage 6.1 — Track A: connection layer and live data

### Files

| Path | Status | Purpose |
|---|---|---|
| `dashboard/.env.local` | new (gitignored) | `SUPABASE_URL` + `SUPABASE_ANON_KEY` |
| `dashboard/lib/supabase.ts` | new | `server-only` Supabase client (anon key, no session persistence) |
| `dashboard/lib/comps.ts` | new | `getComps()` — projects 14 columns, filters `internal_deal = true`, orders by `sale_date DESC NULLS LAST`. **Schema reconciliation:** the prompt's projection assumed columns `lease_rate` and `deleted_at` that don't exist in this DB. `lease_rate` was substituted with `rent_psf` (the standard CRE per-sqft annual rate); the projection aliases it back to `Comp.lease_rate` so downstream code is unaware of the rename. `deleted_at IS NULL` was dropped — no soft-delete column. |
| `dashboard/lib/format.ts` | modified | `Comp` interface grew: `image_filename` removed; `image_url` (nullable), `sale_price`, `lease_rate`, `status`, `property_type`, `submarket_cluster`, `sub_market`, `sale_date` added (all nullable). `validateRenderRequest` no longer checks image — Track B owns image error handling. |
| `dashboard/app/build/comps/page.tsx` | rewritten | calls `getComps()` instead of reading `mock-data/comps.json` |
| `dashboard/app/legacy/page.tsx` | rewritten | same swap |
| `dashboard/components/comps-picker.tsx` | modified | thumbnail uses `c.image_url` directly (public bucket); falls back to a muted box when null. `imageSrc()` proxy removed. |
| `dashboard/components/picker.tsx` | modified | same change in the legacy picker |
| `dashboard/components/edit-render.tsx` | modified | tile thumbnail uses `comp.image_url`; null treated as "No image" |
| `dashboard/templates/Recently_Leased_IOS/render-mapping.ts` | modified | `TilePayload.photo` is now `string \| null` — sourced from `image_url` |
| `dashboard/templates/Recently_Leased_IOS/README.md` | modified | docs updated for the new field |
| `dashboard/app/api/render/route.ts` | modified (interim) | unused `IMAGES_DIR` constant + `checkImagesExist` removed; tile mapping passes `c.image_url ?? ""` through. **Render is broken end-to-end until Track B lands** — InDesign can't `place()` an https URL. tsc passes; runtime render call will fail at the bridge `place()` step with a clear error. By design. |

### Mock-data fallback retained

`mock-data/comps.json` and `mock-data/images/` are intentionally kept on
disk per prompt instruction (offline-dev fallback). The
`/api/images/[filename]` route handler is now unused but kept for the
same reason — if we ever need a quick local-data fallback, both are
ready.

### What's hardcoded vs. configurable

- Project URL + anon key live in `.env.local` (per-environment)
- The `comp-images` bucket name appears nowhere in code — image_url
  values are full URLs that already encode the bucket path
- Filter (`internal_deal = true AND deleted_at IS NULL`) and projection
  list are hardcoded in `dashboard/lib/comps.ts` — Track C may add
  additional client-side filtering on top of this

### Verification

Picker on `/build/comps` loads 281 live comps (counter shows
"281 of 281" with no filter, narrows correctly with the search box).
Sample data verified plausible: real Phoenix-metro addresses, real
SF/AC values, thumbnails load for rows where `image_url` is non-null.
No console or terminal errors. Track A passes.

### Decisions captured during verification

- **`internal_deal = true` retained.** User confirmed: only RGCRE's
  own closed transactions belong on team sheets. External comps
  (`internal_deal = false`) stay deferred to a future BOV / brag-sheet
  workflow.
- **No dedupe.** User noticed apparent duplicates by address (e.g.
  `9801 N 19th Ave` appearing twice) but the rows differ on
  `building_sf` (7,060 vs 11,298) — the same property carrying
  multiple deal records (e.g. partial-building leases at different
  times). Real data shape, not a DB bug. For v1 we treat each row as
  unique. If team-sheet users start picking the wrong "version" of a
  property, revisit with a sale_date-newest dedupe or a
  `(address, sale_date)` uniqueness hint.
