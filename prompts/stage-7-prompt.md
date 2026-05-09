# Stage 7 — Integrate one additional 18-tile template

You are running Stage 7 of an InDesign UXP automation project. Read this entire prompt before starting. Then begin Stage 7.0.

## Context

Stages 1-6 produced a working dashboard with:
- A three-stage flow (template → comps → split-screen edit & render)
- Live Supabase data (281 internal-deal comps with images)
- One template integrated: a 6-tile sample with four fields per tile (address, city/state, sf_ac, photo) and no price or status fields
- Per-render template copies and image-fetch caching
- Filters, search, and selection on the comps picker

Stage 7 adds a second template to the system. The user has three additional templates that are structurally identical — all 18 tiles, all with the same field set. We're integrating ONE of them in this stage to prove the pattern; the other two come along the same path after.

What's new compared to the existing template:
- 18 tiles instead of 6 (the runtime introspection from Stage 5 already handles this)
- Two new per-tile fields: `tile_N_price` and `tile_N_status`
- Possibly new page-level fields (TBD — the user will tell you)

The bridge, plugin, and per-render cleanup logic stay untouched. Stage 7 is dashboard-and-API work plus one manifest entry.

## Stakeholder context

Still a prototype building toward a Hannah review. The price-line rule for when to show a price vs. "Contact Broker" is a real decision that affects what brokers and clients see. You have Supabase read access — use it to ground decisions in the actual data shape rather than guessing.

## How you operate in this stage

You will pause and ask the user to act whenever:

- A step requires GUI interaction or visual inspection
- A judgment call about UX or rule design needs the user's preference
- Template metadata needs to come from the user
- A decision is better made after looking at real data — query the DB yourself first, then present findings to the user

When you need the user, write your request like this:

> **Action required:** [one-line summary]
>
> 1. [step]
> 2. [step]
>
> Reply when done.

Then stop and wait. Do not proceed with assumed values.

When you finish a sub-stage cleanly, do not announce it. Note the result, commit, and move on. Be brief.

## Output structure

All Stage 7 work goes into `STAGE-7-NOTES.md` at the repo root. Match the structure of `STAGE-6-NOTES.md`. Commit incrementally.

## Prerequisites — verify before starting

Run these checks. If any fails, stop and report:

- `STAGE-6-NOTES.md` exists at repo root
- The git tag `stage-6-complete` exists
- The dashboard at `dashboard/` runs successfully on port 4000
- The bridge runs successfully on port 3000
- The build flow works end-to-end with the existing 6-tile template and live Supabase data
- `templates/manifest.json` exists with the existing template entry
- `dashboard/.env.local` is present and Supabase access works
- Working tree is clean

If all checks pass, begin Stage 7.0.

---

## Stage 7.0 — Template metadata gathering

The user has prepared one of the three new 18-tile templates with named frames. You need:

> **Action required:** Tell me about the new template.
>
> 1. **Filename** — the path of the new `.indd` file (you'll pick a name following the existing naming convention; I'll work with whatever you provide).
>
> 2. **Per-tile field names** — the named-frame patterns you used. Confirm:
>    - `tile_N_address` for the street address?
>    - `tile_N_city_state` for "City, ST"?
>    - `tile_N_sf_ac` for the "±SF | ±AC" line?
>    - `tile_N_photo` for the property image?
>    - `tile_N_price` for the price line?
>    - `tile_N_status` for the status badge?
>
>    If any frame name differs from this pattern, tell me the actual name. If any field is missing entirely (e.g., the template doesn't have a status frame), tell me.
>
> 3. **Page-level fields.** What page-level frames did you name in the template? Common ones: `page_title`, `page_tagline`, `page_team_info`, `page_deal_stats`. If you named any, list them with their exact frame names. If none yet, that's fine — page-level overrides will just be unavailable for this template.
>
> 4. **Frames you deliberately did NOT name** (i.e., parts of the template that should stay static — agent bar, footer, disclaimer, etc.) — list them so I know not to look for them.
>
> 5. **Tile count confirmation.** You said all three new templates have 18 tiles. Confirm this template is 18, just to double-check.
>
> Reply with answers. I'll proceed once I have them.

Wait for the response.

When you receive it, do NOT immediately edit the manifest. First, run the introspection check from Stage 5 against this template to confirm the frames are actually addressable.

> **Action required:** Pre-flight before introspection.
>
> 1. Confirm bridge is running on port 3000, plugin connected
> 2. Open the new template in InDesign and make it the active document
> 3. Reply when ready.

Wait.

Then run a smoke-test curl against `/execute` that probes for the new template's frames. Use the same shape as the Stage 3.2 verification, but extended:

- For all 18 tiles, check that `tile_N_address` (text), `tile_N_city_state` (text), `tile_N_sf_ac` (text), `tile_N_price` (text), `tile_N_status` (text), and `tile_N_photo` (rectangle) all resolve via `itemByName` and `isValid` is `true`.
- Also probe any page-level frames the user listed.

Document the response in `STAGE-7-NOTES.md`. If any frames don't resolve, surface to the user and stop until they fix the naming.

Once all frames resolve correctly, commit a placeholder change as `chore: stage 7.0 frame verification for new template` (just the notes update; manifest comes next).

Proceed to 7.1.

---

## Stage 7.1 — Price-line rule decision

Before updating the manifest, the price-line rule needs to be defined. This is the hardest decision in Stage 7 because the rule governs what brokers/clients see and isn't obvious from the data alone.

You have Supabase read access. Use it.

Run a few exploratory queries against the `comps` table to understand the data shape. Then surface findings to the user.

Specifically, query these and document the results in `STAGE-7-NOTES.md` under "Price-line rule investigation":

```sql
-- Distribution of sale_price nullness for SOLD/PENDING/CLOSED-style statuses
SELECT status, 
       COUNT(*) AS total,
       COUNT(sale_price) AS with_sale_price,
       COUNT(*) - COUNT(sale_price) AS null_sale_price
FROM comps 
WHERE internal_deal = true 
GROUP BY status
ORDER BY total DESC;

-- Distribution of lease-rate fields nullness for LEASED/FOR LEASE statuses
SELECT status,
       COUNT(*) AS total,
       COUNT(rent_psf) AS with_rent_psf,
       COUNT(base_rent_total) AS with_base_rent
FROM comps
WHERE internal_deal = true
  AND status IN (<the lease-related statuses you saw in Stage 6.0>)
GROUP BY status;

-- Sample rows with disclosed prices and lease rates so you can see actual values
SELECT id, address, status, sale_price, rent_psf, base_rent_total, lease_format
FROM comps 
WHERE internal_deal = true 
  AND (sale_price IS NOT NULL OR rent_psf IS NOT NULL)
LIMIT 20;
```

Adjust column names if the actual schema differs from these guesses (Stage 6.0 documented the real names).

Once you have the data, surface it to the user with a concrete proposal.

> **Action required:** Price-line rule decision.
>
> Based on querying the comps table, here's what I see:
>
> [Insert summary of findings — e.g., "Of 281 internal deals, X have sale_price populated and Y have rent_psf. Statuses with disclosed prices break down as follows: ..."]
>
> Proposed price-line rule:
>
> 1. If `status` is sale-related (SOLD, FOR SALE, PENDING) AND `sale_price` is not null → show `$X,XXX,XXX`
> 2. If `status` is lease-related (LEASED, FOR LEASE) AND `rent_psf` is not null → show formatted lease rate (e.g., `$12.50/SF NNN` or whatever your lease_format convention is — I'll show you sample rows if helpful)
> 3. Anything else → "Contact Broker"
>
> Two questions:
>
> (a) Does this rule match how Hannah's existing sheets handle the price line? Or do you want a different decision tree?
>
> (b) For lease formatting — the data has rent_psf, base_rent_total, and lease_format. Which combination produces the right rendered string? E.g., should it be "$12.50/SF NNN" or "$10,500/Month NNN" or something else? You may need a sample.
>
> Reply with the rule you want me to implement and any formatting clarifications.

Wait for the answer. Implement exactly what the user specifies — don't add your own interpretations.

Document the chosen rule (with the user's verbatim wording) in `STAGE-7-NOTES.md`. Commit as `docs: stage 7.1 price-line rule decision`.

Proceed to 7.2.

---

## Stage 7.2 — Manifest update and renderer extension

### Manifest entry

Add the new template to `templates/manifest.json` with all six tile fields plus any page-level fields the user listed. Match the existing entry's shape but with the new field set:

```json
{
  "id": "<id chosen by user or derived from filename>",
  "label": "<label chosen by user>",
  "file": "<path>",
  "tile_fields": [
    { "field": "address", "frame_pattern": "tile_{N}_address", "type": "text", "required": true },
    { "field": "city_state", "frame_pattern": "tile_{N}_city_state", "type": "text", "required": true },
    { "field": "sf_ac", "frame_pattern": "tile_{N}_sf_ac", "type": "text", "required": true, "format": "<existing format string>" },
    { "field": "price", "frame_pattern": "tile_{N}_price", "type": "text", "required": false, "rule": "price_line_v1" },
    { "field": "status", "frame_pattern": "tile_{N}_status", "type": "text", "required": false },
    { "field": "photo", "frame_pattern": "tile_{N}_photo", "type": "image", "required": true, "fit": "fillProportionally" }
  ],
  "page_fields": [...],
  "page_fields_static": [...]
}
```

The `rule: "price_line_v1"` reference points to the rule you implement next; this is the convention that lets the manifest stay declarative.

### Price-line formatter

Implement the rule from Stage 7.1 in a shared module — `dashboard/lib/format.ts` (or wherever the existing SF/AC formatter lives). Add a `formatPriceLine(comp)` function that takes a comp record and returns the price-line string per the rule.

Pure function, well-typed, easy to test. If you wrote the SF/AC formatter as a similar pure function, mirror that pattern.

### Render API extension

Update `dashboard/app/api/render/route.ts` to handle the new fields:

- For each tile, set `tile_N_status.contents` to the comp's `status` field directly (no transformation)
- For each tile, set `tile_N_price.contents` to `formatPriceLine(comp)`
- Both go alongside the existing four-field handling

Important: only set these fields if the manifest declares them for the selected template. Templates that don't have `tile_N_price` or `tile_N_status` (the existing 6-tile template) should not get those frames touched. The render code reads the manifest to decide which fields to populate.

This means refactoring the render code, if it isn't already, to be manifest-driven rather than hardcoded to the four-field set. Make this refactor cleanly in this stage — it's the foundation that unlocks the remaining two templates and any future templates with different field sets.

### Verification — first render

> **Action required:** Pre-flight before testing the new template render.
>
> 1. Confirm bridge running, plugin connected, the new template open and active in InDesign
> 2. Confirm the dashboard is running on `localhost:4000`
> 3. Reply when ready.

Wait.

> **Action required:** Test the new template end-to-end.
>
> 1. Open `http://localhost:4000` — the picker should show TWO templates now (the existing 6-tile and the new 18-tile)
> 2. Select the new 18-tile template, continue
> 3. On the comps stage, confirm "Selected (N/18)" — the introspection should resolve count to 18
> 4. Select 18 comps, ideally including a mix of:
>    - At least one SOLD comp with disclosed price
>    - At least one LEASED comp with disclosed rate
>    - At least one with no price (status PENDING or no disclosed price)
>    - Different submarkets, different sizes
> 5. Continue to edit, click Render
> 6. Open the resulting PDF
> 7. Verify:
>    - All 18 tiles populated
>    - Photos look right
>    - Status badges show the right text
>    - Price lines follow the rule we agreed on (real prices for disclosed deals, "Contact Broker" for non-disclosed)
> 8. Reply with how it went, including timing and any issues.

Wait. Iterate on issues.

Common things to check:
- Render time for 18 tiles vs 6 — likely 1.5-3x longer due to image fetch count
- Status badge typography looks right (template's existing styling should handle it; if status text overflows the frame, that's a template-level issue not a code issue)
- Price line formatting matches what Hannah would write

Document timings and observations in `STAGE-7-NOTES.md`. Commit as `feat: stage 7.2 manifest entry and renderer extension for 18-tile template`.

### Regression check on existing template

Don't move on without verifying the old template still works. The render code refactor in this stage could have broken the 6-tile path.

> **Action required:** Regression test on the existing template.
>
> 1. Reset back to `/build/template`
> 2. Pick the existing 6-tile template
> 3. Select 6 comps, render
> 4. Confirm the rendered PDF looks identical to a Stage 6 render — same fields populated, no new fields trying to set frames that don't exist, no errors
> 5. Reply with "regression clean" or with what's different.

Wait. If anything regressed, fix it before proceeding.

Commit any regression fixes as `fix: stage 7.2 preserve existing template behavior`.

Proceed to 7.3.

---

## Stage 7.3 — Edit-stage tile card display

The split-screen edit page (`/build/edit`) shows tile cards for the selected comps. Currently each card displays address, city/state, sf/ac, and image — the existing four fields. With status and price now part of the data being rendered, the cards should show those too so the user sees what the rendered PDF will contain before clicking Render.

Update each tile card to also display:

- Status (small badge or label, near the address)
- Price line (small text, computed via the same `formatPriceLine` used in the renderer — must match exactly)

For templates that don't have status or price fields (the existing 6-tile), these don't need to display on the cards. The card rendering should be aware of which fields the selected template uses (read from the manifest) and only show what's relevant.

Visual treatment:
- Status badge: simple, low-key. Don't try to color-code per status (defer to v2). Plain text in a small badge.
- Price line: small muted text, formatted exactly as the rendered PDF will show it ("$X,XXX,XXX" or "Contact Broker" etc.)
- Don't add new sections — extend the existing card layout

### Verification

> **Action required:** Test the enhanced tile cards.
>
> 1. Pick the 18-tile template, select 18 comps with mixed price/status situations
> 2. On the edit stage, confirm each tile card shows the status text and price line correctly
> 3. Confirm the card text matches what shows up on the rendered PDF (do a render to compare)
> 4. Switch back to the 6-tile template to confirm those cards don't show status/price (the template doesn't have those fields)
> 5. Reply with what you see.

Wait. Iterate.

Document in `STAGE-7-NOTES.md`. Commit as `feat: stage 7.3 tile cards show status and price`.

Proceed to 7.4.

---

## Stage 7.4 — Internal dry run

Run several full renders with the new template to surface any remaining issues:

1. **Mix of price scenarios.** Render with comps that have all four price-line outcomes represented (sold-disclosed, sold-undisclosed, leased-disclosed, leased-undisclosed). Verify each renders correctly.

2. **Missing-image case on the new template.** Pick at least one comp with a known broken or missing image_url. Confirm the existing Track-B handling (option B from Stage 6 — render with empty frame, show warning banner) works for the new template too.

3. **Filter narrow + render.** Use a submarket filter to narrow to ~30-40 comps, pick 18, render. Verify filters still compose correctly.

4. **Repeat-render performance.** Render the same 18-comp set twice. Second render should be meaningfully faster due to image cache. Document the speedup.

5. **Different render after first.** Render once with one set, change selection significantly (different 18 comps), render. Confirm cleanup happened (output/working/ should be empty between renders) and the new render works fresh.

6. **Switch templates mid-session.** Pick the 6-tile template, render, then go back, pick the 18-tile template, render. Confirm switching templates doesn't break anything.

Document everything in `STAGE-7-NOTES.md`. Fix obvious issues. Defer subtle ones unless they'd block Hannah's review.

Commit as `feat: stage 7.4 dry run with new template`.

---

## Stage 7.5 — Wrap-up

If 7.4 went cleanly:

1. Add a one-page Stage 7 summary to `STAGE-7-NOTES.md`. Include:
   - Sub-stages completed
   - Tile counts per template (verify introspection got 6 and 18 correctly)
   - Render times: 6-tile vs 18-tile, first vs cached
   - Any data-quality observations from running real comps through the new template
   - Lessons that would speed up integrating the remaining two templates
   - Open items
2. Tag the commit as `stage-7-complete`. Ask before pushing.
3. Print closing summary.
4. Stop.

If issues remain, document them and ask how to proceed.

---

## What's deferred

- Integrating the remaining two 18-tile templates (same path as Stage 7, faster on repeat — should take a fraction of the time once the user names their frames)
- Status badge color coding per status value (currently text-only)
- Parallelizing image fetches (sequential is fine for 18 tiles; revisit at higher tile counts)
- Price-line rule sophistication beyond v1 (e.g., a `disclose_price` boolean if Mia's curation needs more granularity than `sale_price IS NULL` provides)

Document in `STAGE-7-NOTES.md` so they don't get lost.

---

## Working notes

- Cite file paths and commit hashes throughout.
- Don't run `git push` without confirming with the user.
- Don't modify `bridge/`, `plugin/`, `test-render.js`. Stage 7 is dashboard-and-API only.
- Don't modify the existing 6-tile template's manifest entry beyond what's necessary for the renderer refactor.
- If the user says "stop" at any point, stop.
- Be brief in status messages.

## When you're done

Print a 3-line summary:
- Stage 7 status (complete / blocked / pending)
- New template integration: works / has issues
- Recommendation: ready for the remaining two templates / needs iteration first