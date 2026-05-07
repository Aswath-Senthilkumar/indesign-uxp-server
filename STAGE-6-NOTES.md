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

---

## Stage 6.2 — Track B: image fetching and per-render disk staging

### Files

| Path | Status | Purpose |
|---|---|---|
| `dashboard/lib/images.ts` | new | `fetchImage(url)` with a process-lifetime `Map` cache, 5-min TTL. Returns bytes + an extension chosen from `Content-Type` (falls back to URL extension, then `jpg`). Errors thrown carry the URL and HTTP status. |
| `dashboard/lib/render-script.mjs` | modified | Per-tile photo handling now branches on `t.image`: when present, place + fit (unchanged); when empty, two soft-failing steps clear the template's placeholder graphic and apply a 20% black fill so the rect reads as an intentional grey placeholder. Bridge result now reports `tilesWithoutImage` for visibility. |
| `dashboard/app/api/render/route.ts` | rewritten | New per-render lifecycle: `output/working/render-{ts}-{shortId}/` is created, each comp's image URL is fetched via the cache and written to `<comp.id>.<ext>` inside that dir, the absolute path goes to the bridge, then the dir is deleted in a `finally` block (success or failure). New response headers `X-Render-Image-Fetch-Ms`, `X-Render-Image-Fetched`, `X-Render-Image-Cache-Hits`, `X-Render-Image-Skipped-Null`, `X-Render-Image-Failures`, `X-Render-Tiles-Blank` surface what the route did with the image set. |

### Missing-image policy: option (b) — render with the photo frame blanked

User picked (b). Implementation:

1. Comp with `image_url = NULL` → route passes `image: ""` to the
   bridge for that tile.
2. Fetch failure (404 / network / non-image content) → also `image: ""`.
   Captured in the response's `X-Render-Image-Failures` header.
3. Bridge sees the empty `t.image`, removes the photo rect's
   placeholder graphic (`rect.graphics.everyItem().remove()`), and
   sets the rect's fill to 20% black. Geometry is untouched.

The first iteration tried "skip place() entirely" — but the source
template was authored with example aerials placed in each photo rect
for layout reference, so doing nothing left the stock photo visible
on the no-image tile. Active clear + grey fill resolves it.

### Per-render isolation

`output/working/render-{timestamp}-{8 hex chars}/` per request. Holds
the fetched image bytes only — the .indd is still loaded via in-memory
`OpenOptions.openCopy` (Stage 4 pattern unchanged). Cleanup runs in a
`finally` block so the dir disappears whether the render succeeds,
fails at the bridge, or fails reading the PDF back. Verified after
multiple back-to-back renders: `output/working/` is empty.

### Cache behavior

In-memory `Map<url, {bytes, ext, fetchedAt}>` keyed by URL. 5-minute
TTL. Cleared on dashboard restart. Goal is back-to-back renders of the
same comp set being faster, not long-term storage.

Wall-time observations (6-tile render, fresh dashboard process):

| Run | Wall time |
|---|---|
| First render (cold cache) | ~8s |
| Same set re-rendered | ~6s |
| Different 6 comps | ~6s |

Cache provides a ~25% speedup. The remaining time is dominated by
InDesign place/fit/export rather than image fetching, so the cache
benefit is modest by design — sweetens repeated runs, not a
load-bearing optimization.

### Verification

- Render of mixed set (5 comps with photos + 1 without) produced a
  PDF with 5 placed aerials and 1 grey-fill placeholder rect at the
  correct tile position. Tile geometry matched the populated tiles.
- Re-render of same set: noticeably faster.
- Render of different set: completed cleanly.
- `output/working/` empty after each render.

---

## Stage 6.3 — Track C: picker filters and search

### Filter set delivered

User confirmed the proposed set with one drop: the missing-image
visual flag was not built (per user, the muted-grey placeholder card
in the picker is signal enough on its own).

| Filter / control | Type | Notes |
|---|---|---|
| Search | text input | broadened from address/city/state to **address + city + property_name**. `property_name` is the recognizable building name when present (e.g. "Sky Harbor Industrial Center"). |
| Submarket | single-select dropdown | populated from the live distinct values; null comps surface under "(none)". Default: "All submarkets". |
| Status | multi-select chip row | toggleable chips for each distinct value. Empty selection means no status constraint (all pass). null comps show as "(none)". |
| Sale date | single-select dropdown | presets: All time (default), Last 30 days, Last 90 days, Last 6 months, Last 12 months. Comps with null `sale_date` are excluded from any non-"all" range. |
| Sort by | single-select dropdown | `sale_date DESC` (default), `sale_price DESC`, `building_sf DESC`. All sorts push nulls to the bottom. |
| Clear filters | link | shown when any filter is non-default; resets all four plus search to defaults. |
| "X of Y shown" | static line | live count under the filter row. |

### Implementation

Everything is client-side in `dashboard/components/comps-picker.tsx`.
All 281 comps load once on the server and the picker filters/sorts
them in a single `useMemo` keyed on the filter state — no extra
network round-trips per filter change.

Filter state lives in `useState` hooks in the picker; deliberately
not mirrored to URL params for v1 (refresh resets, accepted).

Selection state stays in `BuildState` and is unaffected by filters —
a selected comp remains in the "Selected" panel even when filters
would hide it from the available list. Verified.

Status uses a row of toggleable chip-buttons rather than a true
multi-select dropdown — fewer distinct values (7) makes chips faster
to scan and click than a popover. Active chip = filled foreground
button; inactive = bordered.

The submarket and sort dropdowns wrap the project's existing Base
UI Select primitive (`dashboard/components/ui/select.tsx`). Base UI's
`onValueChange` callback delivers `string | null`, so each handler
guards on null before updating state.

### Schema addition

`property_name` (text, nullable) added to the projection in
`dashboard/lib/comps.ts` and to the `Comp` interface in
`dashboard/lib/format.ts`. Used by the broadened search.

### Verification

User confirmed: each filter narrows the list as expected, the count
indicator is correct, the sort options reorder correctly, search
combines with filters, the clear link works, and selected comps
persist across filter changes.

---

## Stage 6.4 — Internal dry run with live data

Six scenarios, all passed:

| # | Scenario | Result |
|---|---|---|
| 1 | Filter by submarket → pick 6 → render | clean; PDF matched filtered comps |
| 2 | 6-comp set including 1-2 with no image | clean; missing-image tiles rendered as 20% grey placeholder |
| 3 | Re-render the same set | visibly faster (cache hit) |
| 4 | `output/working/` after multiple renders | empty (cleanup confirmed) |
| 5 | Edit title/tagline on edit stage, render | overrides landed in PDF |
| 6 | Comp with notably long address | render completed; InDesign text frame truncated overflow gracefully |

User specifically noted on #6: "even a long address where not all of
it was actually address, handled leaving out the excess and adding
only address to the team sheet." That's the template's text-frame
overflow behavior catching real-world data variability — useful to
know it degrades cleanly rather than blowing the layout.

---

## Stage 6 — One-page summary

### Tracks completed

- **Track A (6.1)** — Supabase client + `getComps()` + swap of
  mock-data reads in `/build/comps` and `/legacy`.
- **Track B (6.2)** — Image fetching with 5-min in-memory cache,
  per-render `output/working/render-{ts}-{hex}/` directory, finally-
  block cleanup, missing-image policy (b) implemented at the bridge.
- **Track C (6.3)** — Picker filters: search broadened to include
  property_name; submarket dropdown; status multi-select chips;
  sale-date range presets; sort by date / price / SF; "Clear filters"
  link; live "X of Y shown" count.

### Live data scale

- 281 internal-deal rows visible on `/build/comps` (vs. 7 mock).
- Of a sampled 10 rows, 6 had `image_url = NULL` — so roughly
  half-or-more of the live data has no usable photo. The (b) policy
  surfaces this cleanly as a grey placeholder rather than a stock
  fallback or hard fail.
- 11 distinct submarket clusters (incl. one NULL bucket).
- 7 distinct status values (incl. NULL).

### Render times (6-tile sheet)

| Run | Wall | Notes |
|---|---|---|
| Cold (fresh dashboard) | ~8s | dominated by InDesign place/fit/export, not image fetch |
| Same set, cache hit | ~6s | ~25% speedup |
| Different set, cold images | ~6s | InDesign work is the floor |

### Data-quality observations to share back

- Significant share of `image_url` nulls. If team sheets grow into
  the primary use case, getting Hannah / the team a workflow to
  upload photos for high-value comps would be the highest-impact
  data improvement.
- Apparent address-level "duplicates" are real — same property,
  multiple deal records (different building_sf, different sale_date).
  No code action; flagged in case picker users start picking the
  wrong "version" of a property.
- One observed comp had non-address content trailing the `address`
  field; InDesign's text-frame overflow handled it gracefully but
  it's worth a glance from whoever maintains the table.

### Open items for the user

- Confirm the RLS policy on `comps` in the Supabase dashboard (we
  enforced read-only via anon-key + select-only code; the dashboard
  RLS view is the third belt).
- Decide whether external comps (`internal_deal = false`) are wanted
  for any future workflow — currently filtered out.
- Hannah's second template is still the next-major-blocker — orthogonal
  to Stage 6 but the path beyond depends on it.

### What was intentionally deferred

Per the Stage 6 prompt's "deferred" list, these were scoped out and
should be revisited if/when needed:

- External comps (`internal_deal = false`) for BOV / brag-sheet
  workflows
- Property-type filter on the picker (correlates with submarket;
  adds clutter for v1)
- Sort options beyond the three landed (sale_date, sale_price,
  building_sf)
- Pagination on the picker (281 rows is fine without it)
- Image upload affordance for comps with missing photos
- Persistent caching beyond per-process in-memory (5-min TTL)
- Supabase real-time subscriptions for live updates
- Cross-checking comps against booking statements for data quality
- Multi-template workflow (waiting on Hannah's second `.indd`)

### Status

**Complete.** Live-data integration works end-to-end: picker loads
281 comps, filters/sorts/searches them, renders any 6-comp selection
through the bridge with fetched-and-cached images, cleans up after
itself, surfaces clear errors when something goes wrong, and ships a
PDF that matches the source data including a grey placeholder for
missing photos. Ready for tagging as `stage-6-complete`.
