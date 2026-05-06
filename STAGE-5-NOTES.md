# STAGE 5 NOTES

Three-stage build flow for the team-sheet renderer (template → comps → edit
& render) replacing the flat picker UI from Stage 4. Same render pipeline
underneath; the work is mostly frontend plus a thin template-metadata layer.

Companion to `STAGE-2-NOTES.md`, `STAGE-3-NOTES.md`, `STAGE-4-NOTES.md`.

---

## Prerequisites — verified at start

- `STAGE-4-NOTES.md` exists ✓
- `stage-4-complete` tag present locally and on origin ✓
- Dashboard reachable on `localhost:4000` (HTTP 200) ✓
- Bridge reachable on `127.0.0.1:3000` (`/status` → `connected:true`) ✓
- Template present (renamed by user from `template-v2-test.indd` →
  `Recently_Leased_IOS.indd`) ✓
- `mock-data/comps.json` has 7 entries ✓
- Working tree clean of unstaged changes ✓
- HEAD at `634f811` (per-render working copy isolation, openCopy variant)

### Note: `test-render.js` currently broken

The CLI script hardcodes the old filename `templates/template-v2-test.indd`.
The user renamed the file to `templates/Recently_Leased_IOS.indd` before
Stage 5. The Stage 5 prompt says "don't modify `test-render.js`". Leaving
it as-is per that instruction; the dashboard is the primary interface
going forward. The CLI is recoverable with a one-line constant change if
needed.

---

## Stage 5.0 — Template manifest + introspection

### Manifest

`templates/manifest.json` declares one template (the only one currently
in `templates/`):

```json
{
    "templates": [{
        "id": "recently-leased-ios",
        "label": "Recently Leased IOS",
        "file": "templates/Recently_Leased_IOS.indd",
        "tile_fields": [...],
        "page_fields": [
            { "field": "title", "frame": "page_title", "type": "text", "editable": true },
            { "field": "tagline", "frame": "page_tagline", "type": "text", "editable": true }
        ],
        "static_frames_note": "..."
    }]
}
```

Decisions (from the user's response to the metadata gathering questions):

- **Label** is the human-readable form of the .indd filename
  ("Recently Leased IOS"). Future templates the user adds will follow
  the same convention; the manifest entry can override per-template
  when needed.
- **`tile_fields`** mirrors the existing render flow: `address`,
  `city_state`, `sf_ac`, `photo`. No price/status fields in this
  template. Other templates may add fields when they arrive.
- **`page_fields`** has exactly two: `page_title` and `page_tagline`,
  both already named in the .indd. No TBD/null entries — the user
  confirmed both frames exist.
- **Static frames** (`patrick_sior`, `max_sior`, `jack_contact`,
  `patrick_contact`, `max_contact`, `logo`, `tagline_frame`,
  `tile_N` background frames, `declaration`, `company_info`,
  `contact_frame`, `title_frame`) are intentionally not enumerated
  in the manifest. The user said "no need to show them on the
  dashboard, only editable fields and comp ordering in the final
  page." Recorded as a `static_frames_note` for future readers.

`tile_count` is **not** in the manifest — it's resolved at runtime
via introspection.

### Introspection utility

`dashboard/lib/template-introspect.ts` exports
`getTemplateIntrospection(templateId, fileRelative)`. The flow:

1. Resolve the .indd path against `INDESIGN_REPO_ROOT` (env, falls
   back to `process.cwd()/..`).
2. `fs.access` to confirm the file exists.
3. Send a bridge `/execute` script that:
   - Sets `userInteractionLevel = neverInteract`
   - Opens the template via `OpenOptions.openCopy` (so the original
     file is never bound to a Document handle — same isolation
     guarantee as the render flow)
   - Iterates `n = 1..100`, breaks on first miss, counts how many
     `tile_N_address` named text frames resolve as valid
   - Returns `{ ok: true, tileCount, sampleFrames: [...] }`
   - **Always** closes the doc with `SaveOptions.no` in a finally
     block — works because the doc was opened via openCopy
4. Caches the result in a module-level `Map` keyed by template id.
   Lives until the dashboard process restarts. A `force` option
   skips the cache. `clearIntrospectionCache()` exists for dev.

Throws on bridge unreachable, template missing, or
`tileCount === 0` (pattern mismatch between manifest and .indd).

### Verification (probe via curl)

Ran the introspect bridge code as a one-shot probe before committing
the TS wrapper:

```
=== docs before ===
{"result":{"count":0}}

=== introspect probe ===
{
  "result": {
    "ok": true,
    "tileCount": 6,
    "sampleFrames": ["tile_1_address","tile_2_address","tile_3_address"]
  }
}

=== docs after ===
{"result":{"count":0}}
```

- ✅ `tileCount: 6` — matches what the user described
- ✅ `app.documents.length` is 0 before AND after — close worked
  cleanly, no orphan accumulation
- ✅ Template SHA256 unchanged across the probe:
  `fc8f844c0ba707b06db0e9e73b118a053318387519813e0cc7b0ee2672ce010e`
  (this is the new baseline after the user's page_title/page_tagline
  additions; differs from yesterday's `51f4cae7...`)

The `ok=true / tileCount=6 / docs return to 0` triple is the contract
the dashboard's Stage 5.2 will rely on.

### Files

| Path | Role |
|---|---|
| `templates/manifest.json` | NEW — template registry (1 entry currently) |
| `dashboard/lib/template-introspect.ts` | NEW — bridge call + module-level cache |

### Stage 5.0 status: pass

---

## Stage 5.1 — Build flow routing

### Routes

| Path | Role |
|---|---|
| `/` | 307 redirect to `/build/template` |
| `/build/template` | Stage 5.2 — pick a template (Stage 5.1 placeholder) |
| `/build/comps` | Stage 5.3 — filter and pick comps (placeholder) |
| `/build/edit` | Stage 5.4 — split-screen edit + render (placeholder) |
| `/legacy` | Stage 4 flat picker, kept reachable for reference |

### Layout + state

`dashboard/app/build/layout.tsx` wraps the three stages, mounting the
`BuildStateProvider` once so client state survives navigation between
the stages without a route remount. The provider lives in
`dashboard/lib/build-state.tsx` and exposes:

```ts
{
  template: { id, label, tileCount } | null,
  comps: Comp[],
  pageOverrides: Record<string, string>,
  setTemplate, setComps, setPageOverride, reset,
}
```

`setTemplate` clears `comps` + `pageOverrides` when the template id
changes (different templates have different tile counts and page
fields). Selecting the same template again is a no-op so users can
revisit the picker without losing their work.

Refresh-resets-state limitation accepted for v1, per prompt.

### Stepper

`dashboard/components/build-stepper.tsx` (`'use client'`) shows three
steps with derived completion gates:

- **Template:** complete when `template !== null`
- **Comps:** complete when `comps.length === template.tileCount`
- **Edit:** terminal step

The current step is read from `usePathname()`. Reachability rule:
the current step is always reachable; prior steps are reachable
backward (so users can revise); future steps are reachable only when
every prior step is complete. Unreachable steps render as
non-clickable spans with `aria-disabled`.

### Verification

`curl` round trip on every route:

```
GET /                  -> 307, location: /build/template
GET /build/template    -> 200 SIZE=16113   (placeholder + stepper)
GET /build/comps       -> 200 SIZE=16082
GET /build/edit        -> 200 SIZE=16113
GET /legacy            -> 200 SIZE=30809   (old Stage 4 picker)
```

Stepper text present in `/build/template`: "Build progress",
"Choose a template", "Template", "Comps". No compile errors in the
Next dev log.

Human walked the flow:

- `/` redirects ✓
- Stepper visible with step 1 active, 2/3 dimmed ✓
- Disabled forward stepper items don't navigate ✓
- `/legacy` reachable ✓

Reply: "All checks verified, let's proceed."

### Files

| Path | Status | Role |
|---|---|---|
| `dashboard/app/page.tsx` | replaced | now just a `redirect("/build/template")` |
| `dashboard/app/legacy/page.tsx` | new | the old Stage 4 picker moved here |
| `dashboard/app/build/layout.tsx` | new | provider + stepper wrapper |
| `dashboard/app/build/template/page.tsx` | new | placeholder, real UI in 5.2 |
| `dashboard/app/build/comps/page.tsx` | new | placeholder, real UI in 5.3 |
| `dashboard/app/build/edit/page.tsx` | new | placeholder, real UI in 5.4 |
| `dashboard/lib/build-state.tsx` | new | client state context |
| `dashboard/components/build-stepper.tsx` | new | stepper UI |

### Stage 5.1 status: pass

---

## Stage 5.2 — Template selection

### What was built

| Path | Role |
|---|---|
| `dashboard/lib/manifest.ts` | NEW. Reads `templates/manifest.json`, caches per-process. Exposes `loadManifest()`, `getTemplate(id)`. |
| `dashboard/app/api/templates/[id]/introspect/route.ts` | NEW. POST, looks up the template by id, calls `getTemplateIntrospection`, returns `{ tileCount, templatePath }`. 404 unknown id, 502 bridge fail. |
| `dashboard/app/api/templates/[id]/preview/route.ts` | NEW. GET, opens template via `openCopy`, exports PDF, returns inline (`Content-Disposition: inline; filename="…"` so the browser viewer handles save). |
| `dashboard/components/template-picker.tsx` | NEW. Client picker. Renders one card per manifest entry with field chips, Select + Preview buttons. Continue calls introspect, populates BuildState, navigates to `/build/comps`. |
| `dashboard/app/build/template/page.tsx` | UPDATED. Server component that loads the manifest and hands off to the picker. |

### Behavior

- Card per template with `label`, `file`, tile-field chips (gray) and
  page-field chips (blue).
- Preview button is a plain `<a target="_blank">` to the preview
  endpoint — the browser's PDF viewer handles inline display + save.
  No save initiated server-side, per user instruction.
- Clicking Select highlights the card and enables Continue.
- Continue: POST `/api/templates/{id}/introspect` → on 200 sets
  `BuildState.template = { id, label, tileCount }` and routes to
  `/build/comps`. On 4xx/5xx: surfaces error in a destructive Card.
- Loading state on Continue (button → "Loading template…",
  `aria-busy`).

### Verification

```
GET  /build/template                                200, all expected text
POST /api/templates/recently-leased-ios/introspect  200, tileCount=6, 3.2 s
POST /api/templates/unknown/introspect              404, clean error
GET  /api/templates/recently-leased-ios/preview     200, application/pdf,
                                                    273,416 B, %PDF-1.4 magic
```

`app.documents.length` was 0 before and 0 after both API calls — no
orphan accumulation.

Human walked the picker:
- Card renders with file path, tile + page-field chips
- Preview opens in a new tab with the template PDF (browser viewer)
- Select highlights, Continue enables
- Continue shows "Loading template…", then navigates
- Stepper shows Template ✓ / Comps active

Reply: "Everything works as expected, let's continue."

### Stage 5.2 status: pass

---

## Stage 5.3 — Comps selection

### What was built

| Path | Role |
|---|---|
| `dashboard/components/comps-picker.tsx` | NEW. Pure selection UI: search filter, Add/Remove, Selected list, Continue to Edit. Reads `template.tileCount` from BuildState — gating becomes "exactly N selected" where N is the resolved count. |
| `dashboard/app/build/comps/page.tsx` | UPDATED. Server component reads `mock-data/comps.json` and passes to the picker. |

### Header context strip

```
Pick comps                              Change template
Template: Recently Leased IOS · 6 tiles
```

The "Change template" link goes back to `/build/template`. State
survives — the user's prior template selection stays highlighted, and
their comp picks survive the round trip back here too (BuildState
provider lives in the shared layout).

### Recovery state

If the user lands on `/build/comps` with no `template` in BuildState
(e.g., they refreshed the page or pasted a deep link), the picker
renders a recovery Card: *"No template selected. The build flow
starts at template selection."* + a styled `Link` back to
`/build/template`. State context is preserved unconditionally; we
don't auto-redirect because it's clearer for the user to see why
they're being sent back.

### Bug caught + fixed during build

First version called `useMemo` after an early `if (!template) return`
guard, breaking the rules-of-hooks ordering. Restructured so the
hooks run unconditionally and the early return uses values without
calling more hooks.

Also tried `<Button asChild>` (a shadcn Slot pattern) and hit a React
"unknown DOM prop" warning because the locally-installed Button
component doesn't ship with `asChild` support. Replaced with a plain
styled `<Link>`.

### Verification

`curl /build/comps` returns 200 with the recovery-card text when no
template is set. Human walked the full flow:

- Template select → Continue → introspection → land on /build/comps
- Header shows "Recently Leased IOS · 6 tiles"
- Filter narrows to expected results
- Add 6 → 7th becomes "Full" → Continue enables
- "Change template" preserves prior template highlight
- State preserved across re-entry (prior comps still selected on return)
- Refresh on /build/comps shows the recovery card
- Continue to Edit lands on /build/edit (placeholder for now)

Reply: "Everything works seamlessly, let's move on ahead."

### Stage 5.3 status: pass

---

## Stage 5.4 — Split-screen edit & render

The big one. Page-level field editing + drag-reorder of tiles + inline
PDF preview, all on `/build/edit`.

### What was built / changed

| Path | Status | Role |
|---|---|---|
| `dashboard/components/edit-render.tsx` | NEW | The split-screen edit UI: page-field inputs + sortable tile grid + render button on the left, grey/preview/error pane on the right |
| `dashboard/app/build/edit/page.tsx` | UPDATED | Server-side stub that just renders `<EditRender />` |
| `dashboard/app/api/templates/[id]/page-fields/route.ts` | NEW | GET handler that opens template via openCopy, reads each editable `page_field`'s current `.contents`, returns `{ fields: [{ field, frame, label, current_value, missing }] }` so the client gets metadata + values in one round-trip |
| `dashboard/app/api/render/route.ts` | UPDATED | Accepts `{ template_id, tile_count, comps, page_overrides? }`. Looks up the template's file path via `getTemplate()` from manifest. Translates `page_overrides` (keyed by manifest `field`) to bridge-side `(frame, value)` pairs and forwards. Empty-string overrides are dropped server-side so the template default stays. |
| `dashboard/lib/render-script.mjs` | UPDATED | `buildBridgeCode` now accepts a `pageOverrides` array. After tile populate, iterates each override, sets the named frame's `.contents`. Missing frames go into `result.skippedOverrides` (soft signal, not a hard error). Applied frames go into `result.appliedOverrides`. |
| `dashboard/lib/format.ts` | UPDATED | New `RenderRequest` shape: `template_id` + `tile_count` + `comps` + optional `page_overrides`. Validator drops the old hardcoded `template === "template-v2-test"` check; tile count is now a request-side fact carried from the client's introspection cache. |
| `dashboard/components/picker.tsx` | UPDATED | Legacy picker payload migrated to the new shape so `/legacy` keeps working. |
| `dashboard/package.json` | UPDATED | Added `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2. |

### Drag + drop

`DndContext` + `SortableContext` (rectSortingStrategy for grid). Pointer
sensor with a 4 px activation distance so accidental clicks don't
trigger drags; keyboard sensor for accessibility (`sortableKeyboardCoordinates`).
Drop calls `arrayMove(comps, oldIndex, newIndex)` and writes back to
`BuildState.setComps`. Tile-position labels are derived from the
current array index, so they re-number live as cards reorder.

The card body is the drag handle. The remove × button is outside the
listeners block so its click doesn't initiate a drag.

### Grid heuristic

```
≤ 4 tiles -> 2 cols (sm:2)
5–9 tiles -> 3 cols (sm:2 lg:3)
10+ tiles -> 4 cols (sm:2 lg:4)
```

For our current 6-tile template that lands at 3 cols on `lg`, 2 on
`sm`. Tunable later.

### Page-field pre-population

On mount (and whenever the selected template changes — guarded by a
ref so we don't re-fetch on render-state changes), the client fetches
`/api/templates/{id}/page-fields` and stores the response in local
state. The pre-populated values become the input defaults; user edits
go into `BuildState.pageOverrides[field]`. The `valueFor(field)`
helper resolves "override -> current_value -> empty string".

The server endpoint returns `current_value: ""` and `missing: true`
when a frame doesn't exist in the .indd, and the input renders an
amber warning chip next to its label.

### Render button gating

Disabled unless ALL of:
- Template is selected
- Comp count exactly equals `template.tileCount`
- Page-fields have finished loading
- Every editable page-field has a non-empty effective value

The helper text adapts to which condition is unmet so the user knows
why it's disabled.

### Right pane

Three states:
- **Idle / loading:** grey panel (`bg-zinc-200 dark:bg-zinc-800`) with
  centered hint text. Stage 4 prompt called for "Hit Render to
  preview your team sheet"; we honor that wording.
- **Success:** `<embed type="application/pdf">` 680 px tall + Download
  PDF anchor. Header strip shows size + server wall ms.
- **Error:** destructive-styled `Card` with the API error + detail.

Blob URL cleanup via `useEffect` returns its previous URL to
`URL.revokeObjectURL` when state changes, so re-renders don't leak.

### Render API — new shape

Request:

```json
{
  "template_id": "recently-leased-ios",
  "tile_count": 6,
  "comps": [...],
  "page_overrides": { "title": "...", "tagline": "..." }
}
```

The route:
1. Validates body shape via `validateRenderRequest` (now generic over
   any tile_count; old hardcoded check removed).
2. Looks up `template_id` against the manifest. 404 if unknown.
3. Maps `page_overrides[field]` → `{ frame, value }` using the
   manifest's `page_fields[].frame`. Drops any fields not declared
   editable in the manifest. Drops empty strings (template default
   wins).
4. Calls `buildBridgeCode(templatePath, outputPdf, tiles, bridgeOverrides)`.
5. Surfaces `appliedOverrides` and `skippedOverrides` as
   `X-Render-Applied-Overrides` and `X-Render-Skipped-Overrides`
   headers.

### Verification

API direct:

```
POST /api/render with overrides:
  HTTP=200 TIME=3.53s SIZE=273129
  X-Render-Applied-Overrides: page_title,page_tagline
  X-Render-Populate-Ms: 1492
  X-Render-Export-Ms:  699
  app.documents.length: 0 -> 0
```

`/api/templates/recently-leased-ios/page-fields`:

```json
{
  "fields": [
    {
      "field": "title",
      "frame": "page_title",
      "label": "Title",
      "current_value": "SHEEHAN SCHUMACHER | recently leased IOS | Q1 2026",
      "missing": false
    },
    {
      "field": "tagline",
      "frame": "page_tagline",
      "label": "Tagline",
      "current_value": "Over $615 Million in Total Deal Volume Since 2022 vv\r",
      "missing": false
    }
  ]
}
```

Human walked the entire flow:

- Edit & render header + Change comps link visible
- Page-level fields pre-populated with the actual template content
- 6 tile cards render in the grid with images + addresses
- Drag-and-drop reorder works; tile labels re-number live
- Remove × disables Render with a helpful amber message + link back
- Re-add at /build/comps then return; tile order preserved
- Edit Title to "TEST RENDER", Render button enabled
- Click Render → "Rendering…" → preview appears with the new title
- Re-edit + re-render → preview updates (old blob URL revoked)
- Download PDF saves the file
- Empty Title disables Render with "Fill in every page field"

Reply: "works perfectly as expected. what more is left?"

### Stage 5.4 status: pass

---

## Per-template folder structure + page-field font handling (post-5.4 follow-up)

Two requests from the user before continuing to 5.5:

> 1. The page level fields must persist the same font as the existing
>    value in those frames.
> 2. Organize dashboard to have folder level setup for each template,
>    for now all the personalized setup of Recently_Leased_IOS must go
>    inside a folder of that name, and update all imports accordingly
>    to make sure the existing workflow is not affected. Any new
>    template added to the templates directory should just need a
>    setup under a directory of it's name in the appropriate place in
>    dashboard to be added to the product to be integrated.

### Per-template folder structure

`templates/manifest.json` (single file, repo root) is gone. Replaced
by per-template folders under `dashboard/templates/`:

```
dashboard/templates/
└── Recently_Leased_IOS/
    └── manifest.json           # one entry, no top-level "templates" key
```

`dashboard/lib/manifest.ts` now scans `dashboard/templates/` at module
load, reads each `<TemplateName>/manifest.json`, validates shape, and
aggregates into the cached entries array. Behavior is fault-tolerant:

- Missing `dashboard/templates/` → log and return empty array, don't
  throw.
- Missing `manifest.json` in a folder → warn and skip that folder.
- Invalid JSON → warn and skip.
- Missing required fields (id/label/file/tile_fields/page_fields) →
  warn and skip.
- Duplicate id across folders → warn and keep the first.

`getTemplate(id)` and `loadManifest()` keep the same signatures. No
consumer needed updating: the route handlers, the picker, the page
fields endpoint, and the introspection utility all use the same
public API.

To add a new template now:

1. Drop the .indd into `templates/` (repo root, where the asset lives).
2. Create `dashboard/templates/<TemplateName>/manifest.json` with
   `{ id, label, file, tile_fields, page_fields }`.

The dashboard picks it up on next module load (a dev-server hot
reload, or a process restart in prod). No imports to edit.

#### Build issue caught

First version of the new `manifest.ts` had a JSDoc comment containing
`dashboard/templates/*/manifest.json` — Turbopack interpreted the
`*/` mid-comment as the comment terminator, then choked on the rest
parsed as code. Switched to `/* … */` (no JSDoc) without `*/` inside.
Restart picked up the fix; per-template scan resolves correctly:

```
GET  /build/template                                 200, "Recently Leased IOS" rendered
POST /api/templates/recently-leased-ios/introspect   200, tileCount=6
```

### Page-field font handling — investigation, then revert

User reported the page-level title/tagline rendering bolder than the
template's intended weight after a previous override.

First attempt: capture `appliedFont`, `pointSize`, `fontStyle`,
`leading`, `tracking`, `fillColor`, `appliedParagraphStyle`,
`appliedCharacterStyle` from the first character + first paragraph
before `frame.contents = value`, then re-apply across the new range.

Visual verification by user:

> The output/render-fontpreserve.pdf file's font is not the same at
> all, the override sample's text is too bold. The
> output/render-v5-overrides.pdf file's font is perfect.

Diagnosis: InDesign's `textFrame.contents = value` already preserves
the first character's formatting onto the new text — for our
template that gives the right look automatically. The capture-and-
reapply broke it because:

- Capturing `fontStyle` from the *first* character of "SHEEHAN…" got
  the bolder weight of that opening word
- Re-applying that bolder `fontStyle` (and the explicit `appliedFont`)
  across the entire new override range overrode the paragraph
  style's intended typography

The simple `frame.contents = value` doesn't have this problem because
InDesign cleanly inherits paragraph style + first-char attributes
without our forced overrides on top.

**Reverted to the simple form**, with a comment in `render-script.mjs`
documenting the experiment so the next person doesn't repeat it.

Verification after revert:

| File | Bytes | Font correct? |
|---|---|---|
| `render-v5-overrides.pdf` (pre-experiment) | 273,129 | ✓ matches template |
| `render-fontpreserve.pdf` (capture-reapply) | 273,175 | ✗ too bold |
| `render-reverted.pdf` (post-revert) | 273,130 | ✓ matches template (1-byte diff is just PDF timestamp) |

User confirmed `render-reverted.pdf` matches the expected output.

### Files touched

| Path | Change |
|---|---|
| `templates/manifest.json` | DELETED — replaced by per-template files |
| `dashboard/templates/Recently_Leased_IOS/manifest.json` | NEW — single entry for the IOS template |
| `dashboard/lib/manifest.ts` | scans `dashboard/templates/` instead of reading one file |
| `dashboard/lib/render-script.mjs` | reverted page-override path; added comment explaining why the simple `.contents = value` is the right call |

### Status: pass

---

## Stage 5.5 — Polish

Focused pass on UX gaps that came up during the build, not a redesign.

### What changed in `dashboard/components/edit-render.tsx`

**1. Page-fields skeleton.** Replaced the "Loading current values from the
template…" plain-text placeholder with two pulsing label+input shapes
(`animate-pulse` on `bg-muted`). The skeleton is `aria-busy=true` and
labelled so a screen reader still announces "Loading current values
from the template" while the visual changes are happening.

**2. "Made changes" hint after rendering.** New local state
`dirtySinceRender`. Local wrappers `handleSetComps` and
`handleSetPageOverride` set it `true` whenever the user reorders or
removes a tile, or types into a page-field input. The render-success
path resets it to `false`.

The Render button label and helper text now reflect three success
sub-states:

| Condition | Button | Helper line |
|---|---|---|
| `success` && not dirty | "Re-render" | "Preview is up to date." (muted) |
| `success` && dirty | "Re-render" | "You've made changes — re-render to see them." (amber) |
| not yet rendered, can render | "Render" | "Ready to render." |
| loading | "Rendering…" | "Calling the bridge — usually 2-10 seconds." |

The amber tone uses Tailwind's `text-amber-700 dark:text-amber-400`.

**3. Image fallback on tile cards.** `<img>` now has an `onError`
handler that flips `imgFailed` and renders a "No image" gray
placeholder in the same dimensions as the image. Defensive — the
mock data always has valid images, but a future Crexi-import comp
with a broken `image_filename` won't render a broken-image icon.

**4. Skipped-overrides surfacing.** The render success state now
captures `appliedOverrides` and `skippedOverrides` from
`X-Render-Applied-Overrides` / `X-Render-Skipped-Overrides`
response headers. Skipped frames render as a small amber note under
the Download button explaining which frame names weren't found and
suggesting the fix (add the named frame in InDesign or remove the
input from the manifest). Won't trigger for the current template.

### Things deliberately NOT touched

- **Stepper visuals** — already differentiated active / complete /
  unreachable in 5.1; no changes warranted.
- **Back-navigation safety** — BuildState provider survives
  navigation between `/build/*` so back-clicks don't discard state.
  No "are you sure?" prompt needed.
- **Loading/error states everywhere else** — already in place from
  earlier sub-stages.

### Verification

Human walked the polish flow:
- Skeleton appears briefly on first edit-page load
- After Render: button switches to "Re-render", helper says "Preview
  is up to date."
- After typing in Title input: helper switches to amber "You've made
  changes — re-render to see them."
- Drag a tile: same dirty-hint state
- Re-render: helper resets to "Preview is up to date."

Reply: "Everything works just as expected."

### Stage 5.5 status: pass

---
