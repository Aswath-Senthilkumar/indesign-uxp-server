# Stage 6 — Supabase integration for live comps data

You are running Stage 6 of an InDesign UXP automation project. Read this entire prompt before starting. Then begin Stage 6.0.

## Context

Stages 1-5 produced a working three-stage dashboard (template selection → comps selection → split-screen edit & render) that renders team sheets through Hannah's `.indd` template. Comps data currently comes from `mock-data/comps.json` — seven hand-picked entries with local images.

Stage 6 replaces the mock data layer with a live Supabase connection to RGCRE's `comps` table. The user has read-only access to the database (~630 total rows, ~137 marked `internal_deal = true`). Real data brings:

- More comps (~137 internal vs. 7 mock)
- Real fields with real edge cases (null images, varied statuses, mixed property types)
- The need to fetch images from a Supabase storage bucket rather than read from local disk

The bridge, plugin, and template manifest stay untouched. Stage 6 is dashboard-and-render-API work only.

## Stakeholder context

Still a prototype. Still working toward a Hannah review (now with richer data). No auth on the dashboard itself; Supabase access is server-side only. Read-only scope is mandatory and will be enforced via the credentials provided.

## How you operate in this stage

You will pause and ask the user to act whenever:

- A step requires GUI interaction
- A step requires visual inspection
- A judgment call about UX or filter design needs the user's preference
- Credentials, URLs, or access decisions need to come from the user

When you need the user, write your request like this:

> **Action required:** [one-line summary]
>
> 1. [step]
> 2. [step]
>
> Reply when done, or with the output if I asked for one.

Then stop and wait. Do not proceed with assumed values.

When you finish a sub-stage cleanly, do not announce it. Note the result, commit, and move on. Be brief.

## Output structure

All Stage 6 work goes into `STAGE-6-NOTES.md` at the repo root. Match the structure of `STAGE-5-NOTES.md`. Commit incrementally.

Stage 6 is split into three tracks:
- **Track A** — Supabase connection and live data in the picker (Stage 6.1)
- **Track B** — Image fetching and handling in the render API (Stage 6.2)
- **Track C** — Picker UI enhancements for the richer data (Stage 6.3)

Sequence A → B → C. Each track has a hard verification gate before proceeding to the next.

## Prerequisites — verify before starting

Run these checks. If any fails, stop and report:

- `STAGE-5-NOTES.md` exists at repo root
- The git tag `stage-5-complete` exists
- The dashboard at `dashboard/` runs successfully on port 4000
- The bridge runs successfully on port 3000
- The three-stage build flow at `/build/template`, `/build/comps`, `/build/edit` works end-to-end with mock data
- Working tree is clean (`git status`)

If all checks pass, begin Stage 6.0.

---

## Stage 6.0 — Connection details and access scope

Before any code, gather the connection details from the user.

> **Action required:** I need Supabase connection details and a few quick checks before integration.
>
> 1. **Supabase URL** — the project URL, looks like `https://<project-ref>.supabase.co`. Paste it.
>
> 2. **Anon key** — the public/anon key (NOT the service-role key). Looks like a long JWT. Paste it. If you only have a service-role key, tell me and we'll discuss before proceeding — anon is the right scope for read-only prototype use.
>
> 3. **Confirm read-only scope.** Open the Supabase dashboard for this project, go to "Authentication → Policies" or "Database → Tables → comps → RLS policies." Confirm that the policy on `comps` allows SELECT but not INSERT/UPDATE/DELETE for the role the anon key uses. If you're unsure how to verify this, tell me and I'll walk through how.
>
> 4. **The image_url shape.** Open the Supabase table editor for `comps` and look at 3-5 rows where `image_url` is not null. Tell me what the values look like:
>    - Are they full URLs (e.g., `https://<project>.supabase.co/storage/v1/object/public/comp-images/foo.jpg`)?
>    - Are they relative paths (e.g., `comp-images/foo.jpg` or just `foo.jpg`)?
>    - Are some one form and some another?
>
> 5. **Bucket access.** Try opening one of the image URLs (from step 4) in a fresh browser tab while logged out of Supabase, or in an incognito window. Tell me whether the image loads or whether you get a 401/403 error. This determines whether the bucket is public or requires signed URLs.
>
> 6. **`internal_deal` field type.** In the comps table, look at the `internal_deal` column. Is it a boolean (`true`/`false`) or something else? Tell me what you see.
>
> 7. **`status` distinct values.** Run a quick query in the Supabase SQL editor:
>    ```sql
>    SELECT DISTINCT status FROM comps WHERE internal_deal = true ORDER BY status;
>    ```
>    Paste the result. We need to know the actual status vocabulary for the filter UI.
>
> 8. **`submarket_cluster` distinct values.** Same:
>    ```sql
>    SELECT DISTINCT submarket_cluster FROM comps WHERE internal_deal = true ORDER BY submarket_cluster;
>    ```
>    Paste the result.
>
> Reply with answers to all eight. I'll proceed once I have them.

Wait for the user's response.

When you receive the responses:

1. Store the URL and anon key in `dashboard/.env.local` (create the file). Format:
   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   ```
2. Verify `.env.local` is in `dashboard/.gitignore`. If not, add it. NEVER commit credentials.
3. Document the answers to questions 4-8 in `STAGE-6-NOTES.md` under a "Connection details" section. These shape decisions later in the stage.
4. If question 3 (read-only verification) was uncertain or revealed write permissions, stop and ask the user to fix it before proceeding. Do not write code that touches a database with write access we shouldn't have.
5. If question 5 (bucket access) revealed signed-URL requirements, note this — Track B will need to handle URL signing.

Commit only the gitignore change (if any) as `chore: stage 6.0 supabase env setup`.

Proceed to 6.1.

---

## Stage 6.1 — Track A: Connection layer and live data

### Install and configure

Install the Supabase client in the dashboard:

```
cd dashboard
npm install @supabase/supabase-js
```

Create `dashboard/lib/supabase.ts` (server-side only):

```ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error('Missing Supabase credentials in environment');
}

export const supabase = createClient(url, key);
```

Make sure this file is only imported from server components or API routes — never from client components. Add a comment at the top noting this constraint.

### getComps() function

Create `dashboard/lib/comps.ts` with a `getComps()` function:

- Selects: `id, address, city, state, building_sf, land_area, sale_price, lease_rate, status, property_type, submarket_cluster, sub_market, sale_date, image_url`
- Filters: `internal_deal = true` AND `deleted_at IS NULL`
- Orders: `sale_date DESC NULLS LAST`
- Returns the array (no pagination for v1)

Type the return value with a `Comp` interface that matches the projected fields.

If any of the field names from question 6.0 don't match what's documented (e.g., `internal_deal` is actually called something else), use the actual column name and note the discrepancy in `STAGE-6-NOTES.md`.

### Replace mock data load

Find every place in the dashboard where `mock-data/comps.json` is read. Replace those reads with `await getComps()`. Likely locations:

- The `/build/comps` page (server component)
- Any other place that needs comp data

Keep the mock data file in place for now — don't delete it yet. Useful as a fallback for offline development or if Supabase access drops.

### Verification

> **Action required:** Pre-flight before testing.
>
> 1. Confirm `dashboard/.env.local` exists with the Supabase URL and anon key
> 2. Restart the Next.js dev server (`pnpm dev` or `npm run dev`) so it picks up the new env vars
> 3. Reply when ready.

Wait for confirmation.

> **Action required:** Test that real comps load.
>
> 1. Navigate to `http://localhost:4000/build/template`, pick a template, continue to `/build/comps`
> 2. Confirm the comp list shows real comps (not the 7 mock entries — should be ~137)
> 3. Note the row count visible (or shown in any "X comps" indicator)
> 4. Pick a few comps and confirm their data looks plausible (real addresses, real numbers)
> 5. Reply with what you see, including any errors in the browser console or terminal.

Wait for confirmation.

If the load fails:
- Connection errors (401/403) → credentials issue, ask the user to re-verify the anon key
- Empty result → may be the `internal_deal` filter; ask user to verify a few rows in Supabase have `internal_deal = true`
- Field mismatch errors → column names differ from expected; surface to user and update query

If the load succeeds, document row count, sample of data, and any quirks in `STAGE-6-NOTES.md`. Commit as `feat: stage 6.1 supabase connection and live comps data`.

### Track A gate

Before proceeding to Track B, the user must confirm:
- Real comps load in the picker
- The data looks correct (no obvious wrong values)
- No console errors

If anything's off, fix it now. Don't stack Track B on top of a broken connection.

Proceed to 6.2 only when Track A is clean.

---

## Stage 6.2 — Track B: Image handling in render API

This is the highest-risk track. The render API needs to fetch images from Supabase, write them to disk where InDesign can read them, and clean up after rendering.

### Image URL resolution

Based on the user's answer to 6.0 question 4, write a `resolveImageUrl(comp)` helper in `dashboard/lib/images.ts`:

- If `image_url` values are full URLs, return them as-is
- If they're relative paths, prepend the Supabase storage public URL pattern: `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>`
- Bucket name is likely `comp-images` per project knowledge — confirm with the user if uncertain

If question 6.0.5 indicated signed URLs are required (bucket isn't public), use `supabase.storage.from(bucket).createSignedUrl(path, 60)` instead. Note in `STAGE-6-NOTES.md` which path you took.

### Image fetching and caching

Add a `fetchImage(url)` helper that:
- Fetches the image bytes via `fetch()`
- Returns a Buffer or Uint8Array
- On 404, throws a clear error like `Image not found at ${url}`
- On other errors, throws a clear error with status code

Add an in-memory cache keyed by URL with a short TTL (e.g., 5 minutes). Use a simple `Map` — no external cache library. The cache lives for the dashboard process lifetime; restarts clear it. Document the strategy in code comments.

### Per-render temp directory

Update the render API route (`dashboard/app/api/render/route.ts`) to:

1. Create a per-render working directory: `output/working/render-{timestamp}-{shortId}/` (extending the existing per-render `.indd` copy pattern from Stage 4)
2. For each comp's image:
   - Resolve the URL
   - Fetch the bytes (with cache)
   - Write to `output/working/render-{ts}-{id}/<comp-id>.jpg` (or appropriate extension based on Content-Type)
3. The `/execute` payload references these temp file paths, not the original Supabase URLs
4. After successful PDF export AND successful response to the client, delete the entire per-render working directory (including the .indd copy and all images)
5. On any error mid-render, delete the per-render working directory in a finally/catch block — no orphans

Keep the existing per-render `.indd` copy logic intact; just extend it to also house the images.

### Missing-image handling

Decide with the user how to handle comps with null `image_url` or fetch failures. **Stop and ask:**

> **Action required:** A render decision.
>
> When a selected comp has a null `image_url` or the fetch returns 404, what should happen?
>
> Options:
>
> (a) **Fail the render with a clear error** — "Comp at <address> has no usable image. Replace it before rendering." Forces the user to deal with the gap upfront.
>
> (b) **Render with the photo frame empty** — leaves a blank rectangle in the PDF. The render succeeds; the gap is visible in the output.
>
> (c) **Use a placeholder image** — a generic "no image" graphic gets placed. Render looks complete but the gap is hidden.
>
> My recommendation is (a) — fail loud and early. The system shouldn't silently produce incomplete sheets, and gaps in `comps.image_url` are real data-quality issues worth surfacing to whoever's using the dashboard.
>
> Reply with (a), (b), or (c).

Wait for the answer. Implement accordingly.

### Verification

> **Action required:** Pre-flight for Track B testing.
>
> 1. Confirm bridge is running, plugin connected, template active
> 2. Confirm dashboard runs and Track A's live comp data is loading
> 3. Reply when ready.

Wait for confirmation.

> **Action required:** Test image rendering with real comps.
>
> 1. Navigate the build flow: pick template, pick the right number of comps (use real ones from the live data — pick a mix that includes at least one with a clearly populated image)
> 2. On the edit stage, click Render
> 3. Wait for the render to complete (may take longer than mock data did due to image fetches — single-digit seconds is still expected on first render; subsequent renders should be faster due to caching)
> 4. Check the rendered PDF — confirm the photos are correct and match the selected comps
> 5. Render again with the same comps — confirm it's faster (cache hit)
> 6. Render again with different comps — confirm new images get fetched
> 7. Reply with timing observations and whether the photos look right.

Wait for confirmation. Iterate on issues. Common failure modes:

- Image fetch fails with CORS/auth errors → URL resolution issue, may need signed URLs
- Photos render but look wrong (rotated, tiny, wrong aspect) → InDesign placement issue, may need `FitOptions` adjustment
- Temp directory doesn't get cleaned up → cleanup logic bug, fix the finally block

Document timings (first render vs. cached render) in `STAGE-6-NOTES.md`. Commit as `feat: stage 6.2 image fetching and per-render cleanup`.

### Track B gate

Before proceeding to Track C:
- Render completes successfully with real comps and real images
- Cleanup is working (check `output/working/` is empty after a successful render)
- Cache provides observable speedup on second render
- Missing-image handling works per the user's chosen strategy

Proceed to 6.3 only when Track B is clean.

---

## Stage 6.3 — Track C: Picker UI enhancements

The data is real, the render works. Now make the picker actually usable for ~137 comps.

### Filter design check-in

Before building, surface the filter set to the user.

> **Action required:** Confirm the filter set.
>
> Based on the data we have, I'm planning to add these filters to the comps picker:
>
> 1. **Submarket cluster** — dropdown, populated from the distinct values you sent in 6.0.8
> 2. **Status** — multi-select, populated from the distinct values you sent in 6.0.7
> 3. **Sale date range** — preset options: Last 30 days, Last 90 days, Last 6 months, Last 12 months, All time. Default: All time.
>
> Plus enhancements to existing controls:
>
> 4. **Search** — broaden from address-only to address + city
> 5. **Sort** — default sale_date DESC; add options for sale_price DESC and building_sf DESC
> 6. **Missing-image indicator** — comps with null/broken image_url get a visual flag (small icon, muted card style)
>
> Reply: confirm this set, or tell me to add/remove anything before I build.

Wait for confirmation.

### Implementation

Build the filters in `dashboard/app/build/comps/page.tsx` (or wherever the comps picker lives). Considerations:

- Filter state held in React state (no URL params for v1 — keeps it simple)
- Filters apply client-side (we have all 137 comps loaded; no need for server-side filtering)
- Filters compose: search + filter combinations narrow the list
- "Selected" panel is unaffected by filters — selecting a comp keeps it selected even if filters would hide it
- A small "X comps shown" count above the list updates as filters change
- A "Clear filters" button when any filter is active

UI hierarchy:
- Search bar at the top (full width)
- Filter row below (3 dropdowns/multi-selects, compact)
- Sort selector at the right end of the filter row
- Comp list below (filtered, sorted)
- Selected panel sticky on the side or bottom

Use shadcn/ui's `Select`, `Combobox` (or a pattern with `Popover` + `Command`), and `Input` components. Don't build custom dropdowns from scratch.

### Missing-image visual treatment

For comps with null image_url:
- Card shows a muted gray box with a small "no image" icon instead of a thumbnail
- A small badge or tooltip indicates "Photo missing"
- Card is still selectable (user might want to render anyway and deal with the placeholder per the Track B strategy)

For comps where the URL is set but resolves to 404, we don't know that until render time. That's fine — handled at render per Track B's decision.

### Verification

> **Action required:** Test the enhanced picker.
>
> 1. Navigate to `/build/comps`
> 2. Try the filters individually:
>    - Submarket cluster — pick one, confirm the list narrows
>    - Status — multi-select a couple, confirm filtering works
>    - Date range — try Last 30 days, then Last 6 months, confirm count changes appropriately
> 3. Try filter combinations
> 4. Try the address+city search alongside filters
> 5. Try the sort options (sale_date, sale_price, building_sf)
> 6. Confirm the "X comps shown" count updates correctly
> 7. Confirm selected comps stay selected when filters change
> 8. Look for at least one comp with a missing image — confirm the visual flag is clear
> 9. Reply with any UX rough edges.

Wait for confirmation. Iterate. Don't over-polish.

Document filter design and any tuning in `STAGE-6-NOTES.md`. Commit as `feat: stage 6.3 picker filters and visual enhancements`.

---

## Stage 6.4 — Internal dry run

Run the full flow several times with real data:

1. Pick a template, filter to a specific submarket, render with 6 comps from that submarket
2. Try a render where one of the selected comps has a missing image (confirm it behaves per the Track B decision)
3. Render the same set twice in a row — confirm the second is faster (cache)
4. Render different sets back-to-back — confirm cleanup works (no orphans in `output/working/`)
5. Edit a page-level field on the edit stage, render, confirm overrides land in the PDF
6. Test with a comp that has unusual data: very long address, missing fields, unusual status

Document rough edges. Fix the obvious ones. Defer the rest.

Commit as `feat: stage 6.4 dry run with live data`.

---

## Stage 6.5 — Wrap-up

If 6.4 went cleanly:

1. Add a one-page Stage 6 summary to `STAGE-6-NOTES.md`. Include:
   - Tracks completed
   - Comp count visible (likely ~137)
   - Render times: first render with new comps, cached render
   - Any data-quality observations (how many comps have missing images, etc.)
   - Open items for the user
2. Tag the commit as `stage-6-complete`. Ask before pushing.
3. Print closing summary.
4. Stop.

If issues remain, document them and ask how to proceed.

---

## What's deferred (note now, build later)

These were intentionally scoped out of Stage 6:

- External comps (`internal_deal = false`) — for BOV / brag-sheet workflows, not team sheets
- Property type filter — correlates with submarket, adds clutter for v1
- Custom sort options beyond the three listed
- Pagination — won't need it at 137 rows
- Image upload affordance for comps with missing photos
- Persistent caching beyond per-session in-memory
- Supabase real-time subscriptions for live updates
- Cross-checking comps against booking statements for data quality
- Multi-template workflow (deferred per user's plan to integrate Supabase first, then templates)

Document in `STAGE-6-NOTES.md` so they don't get lost.

---

## Working notes

- Cite file paths and commit hashes throughout.
- Don't run `git push` without confirming with the user.
- Don't commit `.env.local` or any file containing real credentials. Verify `.gitignore` before every commit.
- Don't modify `bridge/`, `plugin/`, `test-render.js`, or `templates/`. Stage 6 is dashboard-and-API only.
- If the user says "stop" at any point, stop.
- Be brief in status messages.

## When you're done

Print a 3-line summary:
- Stage 6 status (complete / blocked / pending)
- Live data integration: works / has issues
- Recommendation: ready for next phase / needs iteration