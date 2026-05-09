# Stage 5 — Three-stage team-sheet build flow

You are running Stage 5 of an InDesign UXP automation project. Read this entire prompt before starting. Then begin Stage 5.0.

## Context

Stages 1-4 produced a working dashboard that renders a 6-tile team sheet from mock data through Hannah's `.indd` template. The dashboard currently has:
- One template (`templates/template-v2-test.indd`)
- A flat picker UI (search comps, select 6, render)
- An inline PDF preview after render
- Per-render template copies (`output/working/`) so the original is never mutated

Stage 5 redesigns the user flow as three explicit stages with richer per-stage context and a split-screen final stage that supports inline editing of template text and drag reordering of selected tiles before render.

Stages 5.1-5.4 add the new flow on top of the existing render pipeline. The bridge, plugin, and render API endpoint stay untouched. The work is mostly frontend with a template-metadata layer underneath.

**Important note on tile count:** the system does NOT require the user to specify a tile count or grid arrangement upfront. Tile count is inferred at runtime by introspecting the template's named frames (counting `tile_N_*` patterns). The user provides the field set per tile and any page-level fields; the count comes from the template itself.

## Stakeholder context

This is still a prototype, building toward a Hannah review. No auth, no persistence, mock data still acceptable for v1 of this flow. The flow refactor is meant to demonstrate the *intended* user experience clearly, not to be production-grade.

## How you operate in this stage

You will scaffold, write code, run dev servers, and verify outputs autonomously. You will pause and ask the user to act whenever:

- A step requires GUI interaction
- A step requires visual inspection
- A judgment call about UX is needed
- Template metadata (which fields each template has) needs to come from the user

When you need the user, write your request like this:

> **Action required:** [one-line summary]
>
> 1. [step]
> 2. [step]
>
> Reply when done, or with the output if I asked for one.

Then stop and wait.

When you finish a sub-stage cleanly, do not announce it. Note the result, commit, and move on. When something fails, stop and report. Be brief.

## Output structure

All Stage 5 work goes into `STAGE-5-NOTES.md` at the repo root. Match the structure of `STAGE-4-NOTES.md`. Commit incrementally.

The new flow lives at `dashboard/app/build/` (or restructure `dashboard/app/page.tsx` into routed stages — your call, document the choice). The existing dashboard remains accessible during development but the new flow becomes the primary entry point.

## Prerequisites — verify before starting

Run these checks. If any fails, stop and report:

- `STAGE-4-NOTES.md` exists at repo root
- The git tag `stage-4-complete` exists
- The dashboard at `dashboard/` runs successfully on port 4000
- The bridge runs successfully on port 3000
- `templates/template-v2-test.indd` exists with all 24 named frames (tiles 1-6, four frames each)
- `mock-data/comps.json` has at least 6 entries
- Working tree is clean (`git status`)

If all checks pass, begin Stage 5.0.

---

## Stage 5.0 — Template metadata gathering

Before any UI work, we need to formalize template metadata. Each template has a per-tile field set (some templates have status/price, some don't) and page-level editable fields (title, tagline, etc.). The dashboard needs this metadata to drive the new flow.

Tile count is NOT user-provided metadata. The system determines tile count at runtime by querying the template via the bridge: count how many tile slots exist by checking which `tile_N_*` named frames are present (e.g., if `tile_1_address` through `tile_6_address` exist, tile_count = 6).

The user has confirmed: the current 6-tile template has no price or status fields. Other fields per tile (address, city/state, SF/AC, photo) and any page-level fields are TBD.

> **Action required:** I need template metadata for the 6-tile sample template, and any others you want included.
>
> For each template, tell me:
>
> 1. Template name (e.g., "Phoenix Heavy Industrial")
> 2. The `.indd` file path (e.g., `templates/template-v2-test.indd`)
> 3. Per-tile fields and the named frame pattern for each (e.g., `tile_N_address`, `tile_N_city_state`, `tile_N_sf_ac`, `tile_N_photo` — you've already named these for the sample template)
> 4. Per-tile fields that are NOT in this template (e.g., this one has no price or status — confirm)
> 5. Page-level editable fields and their named frames (e.g., `page_title`, `page_tagline`, `page_team_info`, `page_deal_stats`). If you haven't named these in the template yet, list what fields exist visually and tell me whether you want to add named frames for them.
> 6. Any page-level fields that should be displayed in the editor but NOT editable (e.g., agent bar — usually static across renders)
>
> Reply with this for the 6-tile template at minimum. If you have other templates in flight, include them too. Otherwise we'll start with one.

Wait for the user's response.

When you receive it, build a `templates/manifest.json` file with a structured entry per template. Shape:

```json
{
  "templates": [
    {
      "id": "phoenix-heavy-industrial",
      "label": "Phoenix Heavy Industrial",
      "file": "templates/template-v2-test.indd",
      "tile_fields": [
        { "field": "address", "frame_pattern": "tile_{N}_address", "type": "text", "required": true },
        { "field": "city_state", "frame_pattern": "tile_{N}_city_state", "type": "text", "required": true },
        { "field": "sf_ac", "frame_pattern": "tile_{N}_sf_ac", "type": "text", "required": true, "format": "±{building_sf:number} SF | ±{land_area:number_2dp} AC" },
        { "field": "photo", "frame_pattern": "tile_{N}_photo", "type": "image", "required": true, "fit": "fillProportionally" }
      ],
      "page_fields": [
        { "field": "title", "frame": "page_title", "type": "text", "editable": true },
        { "field": "tagline", "frame": "page_tagline", "type": "text", "editable": true }
      ],
      "page_fields_static": [
        { "field": "agent_bar", "editable": false }
      ]
    }
  ]
}
```

Adjust based on the user's response. If the user says certain page-level frames don't exist yet, flag them as TBD in the manifest with a `frame: null` and a `notes` field explaining what needs to be named in InDesign. Do NOT name them yourself — that's Hannah's or the user's call.

If the user provides metadata for additional templates beyond the 6-tile sample, include them all. If only one template is provided, that's fine.

### Tile-count introspection

Build a small utility — `dashboard/lib/template-introspect.ts` (or similar location) — that queries the bridge to determine tile count for a given template. The flow:

1. Send an `/execute` script that opens the template (or uses the active document if it's already open), counts how many text frames match the pattern `tile_N_address` (using the manifest's first tile_field as the canonical existence check), and returns the count.
2. Cache the result per template ID — don't re-query on every page load.
3. Expose `getTileCount(templateId)` as the entry point used by Stages 5.2, 5.3, and 5.4.

The introspection happens once per template per session. If a template's frame structure changes mid-session, a refresh handles it.

Record the manifest creation and introspection utility in `STAGE-5-NOTES.md`. Commit as `feat: stage 5.0 template manifest and introspection`.

---

## Stage 5.1 — Stage routing structure

Restructure the dashboard's flow into three explicit stages with routes:

- `/build/template` — Stage 1: pick a template
- `/build/comps` — Stage 2: filter and pick comps
- `/build/edit` — Stage 3: edit and render

Add a top-level wrapper layout for `/build/*` that shows progress (e.g., "Step 1 of 3: Template" → "Step 2 of 3: Comps" → "Step 3 of 3: Edit & Render"). Use a simple horizontal stepper from shadcn or build with Tailwind primitives.

State management: use Next.js searchParams or a client-side context provider that persists state across the three routes. The user must be able to:
- Move forward through stages (with valid input)
- Move back to a previous stage to revise (without losing later state if possible)
- Refresh on any stage and have the app handle gracefully (probably reset to stage 1)

For v1, accept the refresh-resets-state limitation. Don't add localStorage persistence yet.

The home `/` route should redirect to `/build/template` so the new flow is the default.

> **Action required:** Confirm the new flow shell.
>
> 1. Visit `http://localhost:4000`
> 2. Confirm you land on `/build/template` with a 3-stage stepper at the top
> 3. Click through to confirm the routes exist (even if the pages are placeholders)
> 4. Reply when confirmed.

Wait for confirmation.

Record in `STAGE-5-NOTES.md`. Commit as `feat: stage 5.1 build flow routing`.

---

## Stage 5.2 — Stage 1: Template selection

Build the `/build/template` page.

Layout:
- Page title: "Choose a template"
- Brief description: "Each template has a fixed field set. Pick the one that fits the sheet you're building."
- A list/grid of template cards, one per entry in `templates/manifest.json`. Each card shows:
  - Template label
  - Per-tile field set as small chips/badges (e.g., "Address", "City/State", "SF/AC", "Photo" — call out any conditional ones like "Status" or "Price" with a different color or style if present)
  - Page-level editable fields as chips (e.g., "Title", "Tagline")
  - A "Select" button
- Selected template highlights visibly
- A "Continue" button at the bottom, disabled until a template is selected. On click:
  1. Call the introspection utility to determine tile count for the selected template (cache the result)
  2. Navigate to `/build/comps` with the selected template ID and resolved tile count in state

If only one template exists in the manifest, still show it as a card with selection — the UI should feel natural even at scale.

If introspection fails (template can't be opened, frames not found), surface the error clearly and don't proceed to the next stage.

> **Action required:** Pre-flight before testing.
>
> 1. Confirm bridge is running on port 3000, plugin connected
> 2. Confirm `templates/template-v2-test.indd` is openable (either active document or accessible to the bridge)
> 3. Reply when ready.

Wait for confirmation.

> **Action required:** Test the template picker.
>
> 1. Open `http://localhost:4000/build/template`
> 2. Confirm template cards render with the right metadata
> 3. Select a template, confirm the Continue button enables
> 4. Click Continue
> 5. Verify the introspection ran (check console or network tab) and the resolved tile count carried into Stage 2's state
> 6. Confirm you land on `/build/comps`
> 7. Reply with anything off.

Wait for confirmation. Iterate on issues. Record in `STAGE-5-NOTES.md`. Commit as `feat: stage 5.2 template selection`.

---

## Stage 5.3 — Stage 2: Comps selection

Build the `/build/comps` page.

This stage is essentially the existing dashboard's picker UI, but reading the resolved tile_count from the introspection cache (so the "Selected (N/6)" becomes "Selected (N/{tile_count})") and showing the template context at the top.

Layout:
- Header strip showing the selected template (label, resolved tile count) with a "Change" link back to `/build/template`
- Address search input as before
- Comp list with thumbnails as before
- Selected panel showing comps in selection order with remove buttons
- A "Continue to Edit" button at the bottom, disabled until exactly tile_count comps are selected

State carries over from Stage 1 (template ID, tile count) and adds the selected comps array.

The mock data continues to load from `mock-data/comps.json` for now. (Real Supabase integration is deferred per user's instruction.)

> **Action required:** Test the comps stage.
>
> 1. From the template stage, select a template and continue
> 2. Confirm the header shows the template name and required count (count came from introspection)
> 3. Search and select the right number of comps
> 4. Try going back via the "Change" link — confirm the template selection is preserved
> 5. Click Continue to Edit
> 6. Reply with anything off.

Wait for confirmation. Iterate. Record. Commit as `feat: stage 5.3 comps selection`.

---

## Stage 5.4 — Stage 3: Split-screen edit & render

This is the big one. The split-screen edit-and-render page at `/build/edit`.

Layout:

```
┌──────────────────────────┬──────────────────────────┐
│  LEFT (50%)              │  RIGHT (50%)             │
│                          │                          │
│  [Page-level fields]     │  Initial state:          │
│                          │  Plain grey panel with   │
│  Title:    [text input]  │  a centered hint:        │
│  Tagline:  [text input]  │  "Hit Render to preview" │
│  ...                     │                          │
│                          │  After render:           │
│  [Tile arrangement]      │  Inline PDF viewer       │
│                          │  + Download button       │
│  Drag-reorderable cards  │                          │
│  in a sensible grid      │                          │
│  (default: 2-3 cols)     │                          │
│  Each card shows comp    │                          │
│  data + remove button    │                          │
│                          │                          │
│  [Render] button         │                          │
└──────────────────────────┴──────────────────────────┘
```

### Left side details

**Page-level fields section (top):**
- For each `page_field` in the selected template's manifest where `editable: true`, render a labeled text input
- Pre-populate each input with the *current value* of that frame in the template
- To get current values: at page load, call the bridge's `/execute` endpoint with a script that reads each named frame's `.contents` and returns them as a JSON object. Use this to populate the inputs.
- If the user edits a field, that override is held in client state; on render, the new value is sent in the render payload
- If the user leaves a field unchanged, the original value is sent (or omitted, since the template already has it — render logic should handle either case)

**Tile arrangement section (middle):**
- Render the selected comps as draggable cards in a CSS grid
- Default grid: pick a sensible column count based on the resolved tile_count (e.g., 2 columns if count ≤ 4, 3 columns if 5-9, 4 columns if 10+). Document the heuristic in code comments — this can be tuned later.
- Use a drag-and-drop library: `@dnd-kit/core` is recommended (works well with Next.js, accessible, no React 18 concurrency issues)
- Each card shows:
  - Comp address
  - City, state
  - SF/AC line
  - Property image thumbnail
  - A small remove (×) button in the corner
  - A "tile position" label that updates as cards are reordered (e.g., "Tile 1", "Tile 2"...)
- Reordering cards updates the order in client state
- Removing a card decrements the count below the resolved tile_count, which disables the Render button

**Render button (bottom):**
- Enabled when:
  - Exactly tile_count comps are present in the arrangement
  - All required page-level fields have non-empty values
- Click triggers a POST to `/api/render` with:
  - The selected template ID
  - The ordered comps array
  - The page-field overrides
- Loading state while rendering
- Success: render completes, right side updates

### Right side details

**Initial state (before any render):**
- Plain grey background (e.g., `bg-zinc-200` or similar muted tone)
- Centered hint text: "Hit Render to preview your team sheet"
- Optional: a subtle illustration or icon

**After successful render:**
- Inline PDF viewer (use `<embed>` like in Stage 4 or upgrade to PDF.js if needed)
- A "Download PDF" button at the bottom right of the viewer
- A small "Re-render" button or similar so the user can re-trigger after edits without reloading the page
- If the user edits a field on the left after rendering, optionally show a "Re-render to see changes" hint

**On render error:**
- Right side shows an error state (red banner with the error message, retry option)

### State persistence within the stage

- Edits to page fields persist as the user types (don't lose them on tile reorder)
- Tile reorders persist when editing page fields
- Render is explicit — user must click the button to trigger a render

### Render payload changes

The `/api/render` endpoint may need to accept additional fields in its payload to handle page-level overrides. Update it to accept:

```json
{
  "template_id": "phoenix-heavy-industrial",
  "comps": [...],
  "page_overrides": {
    "title": "string or omitted",
    "tagline": "string or omitted"
  }
}
```

The /execute script then:
1. Opens the working copy (already does this from per-render copy work)
2. Sets each tile's frames from the comps array (already does this — uses tile_count as the loop bound)
3. For each page_field override, sets that frame's contents to the override value
4. Exports

If the user makes no overrides, the page-level frames stay as they are in the template (which is what you'd want — the template's text is the default).

> **Action required:** Pre-flight before testing the edit stage.
>
> 1. Confirm bridge is running, plugin connected, template-v2-test.indd is the active document
> 2. Confirm dashboard runs on `localhost:4000`
> 3. Confirm you've named at least one page-level frame in the template (e.g., `page_title` or `page_tagline`). If you haven't, the inputs will be empty and that's fine for the demo — but ideally name at least one so we can prove the read-back works.
> 4. Reply when ready.

Wait for confirmation.

Test:

> **Action required:** Test the split-screen edit & render flow.
>
> 1. Navigate through stages 1, 2, 3 with a template and the right number of comps
> 2. On stage 3:
>    - Confirm the left side shows page-field inputs (with template's current values pre-populated, if frames are named)
>    - Confirm the tile grid renders
>    - Try reordering tiles by drag-and-drop
>    - Try removing a tile (Render button should disable)
>    - Re-add by going back to comps stage
>    - Edit a page-field value
>    - Click Render
>    - Confirm the right side shows the rendered PDF
>    - Confirm the PDF reflects the tile order and page-field overrides
> 3. Click Download, confirm PDF saves
> 4. Reply with anything off.

Wait for confirmation. Iterate. Don't move on until the flow works end-to-end with reordering and field overrides.

Record in `STAGE-5-NOTES.md`. Commit as `feat: stage 5.4 split-screen edit and render`.

---

## Stage 5.5 — Polish

Once the end-to-end flow works, spend a focused session on polish:

1. **Stepper visual states.** Active stage highlighted, completed stages checkable for navigation back, future stages dimmed.
2. **Back-navigation safety.** When user clicks back to a previous stage, don't silently discard later state — confirm or warn.
3. **Empty/initial states.** What does the right pane show before render? What does the tile grid show if a comp has no image?
4. **Loading states.** Pre-population of page fields requires a bridge round-trip; show a skeleton or spinner during it. Render itself shows a loading state.
5. **Error states.** Bridge down, plugin disconnected, template not found, frame not addressable — each should produce a clear, actionable error.

Don't over-invest. Stop polishing when it's acceptable.

Record in `STAGE-5-NOTES.md`. Commit as `feat: stage 5.5 polish`.

---

## Stage 5.6 — Internal dry run

Run the flow yourself a few times with different combinations:

1. Different template (if multiple exist) — confirm metadata flows correctly and tile-count introspection works for each
2. Different comp combinations
3. Edit page fields and confirm overrides land in the PDF
4. Reorder tiles and confirm the rendered order matches
5. Render once, edit a field, re-render — confirm right side updates
6. Try edge cases: leave a page field empty, click Render, confirm clear error or graceful handling

Document rough edges in `STAGE-5-NOTES.md`. Fix obvious ones, defer the rest.

Commit as `feat: stage 5.6 dry run iteration`.

---

## Stage 5.7 — Wrap-up

If 5.6 went cleanly:

1. Add a one-page Stage 5 summary to `STAGE-5-NOTES.md`. Include:
   - Sub-stages completed
   - Templates supported (with resolved tile counts from introspection)
   - Render times observed (template-load, populate, export, total)
   - Open items for the user

2. Tag the commit as `stage-5-complete`. Ask before pushing.

3. Print closing summary.

4. Stop.

If issues remain, document them and ask how to proceed.

---

## Working notes

- Cite file paths and commit hashes throughout.
- Don't run `git push` without confirming.
- Don't modify `bridge/`, `plugin/`, `test-render.js`, or the existing `dashboard/app/api/render/route.ts` beyond what's needed to handle page-level overrides.
- Don't modify `.indd` template files. The user manages those.
- If the user says "stop" at any point, stop.
- Be brief in status messages.

## When you're done

Print a 3-line summary:
- Stage 5 status (complete / blocked / pending)
- Three-stage flow: works / has issues
- Recommendation: ready for Hannah review / needs iteration