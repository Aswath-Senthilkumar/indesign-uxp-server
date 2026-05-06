# STAGE 5 NOTES

Three-stage build flow for the team-sheet renderer (template → comps → edit
& render) replacing the flat picker UI from Stage 4. Same render pipeline
underneath; the work is mostly frontend plus a thin template-metadata layer.

Companion to `STAGE-2-NOTES.md`, `STAGE-3-NOTES.md`, `STAGE-4-NOTES.md`.

---

## Stage 5 — One-page summary

**Branch:** `analysis/initial-pass`
**Reference tag (Stage 4):** `stage-4-complete` at `ecd3985`.
**Commits added since stage-4-complete:** **10** (this wrap-up + 9
prior). Includes one pre-Stage-5 working-copy isolation commit
(`634f811`) that became the substrate for everything Stage 5 builds
on.

### Sub-stages

| | Status | Commit |
|---|---|---|
| (pre-5) per-render working copy via `OpenOptions.openCopy` | ✅ | `634f811` |
| 5.0 Template manifest + introspection | ✅ | `885b843` |
| 5.1 Build flow routing (`/build/{template,comps,edit}`) | ✅ | `164a495` |
| 5.2 Template selection + preview endpoint | ✅ | `f11c4d8` |
| 5.3 Comps selection | ✅ | `45ab8f3` |
| 5.4 Split-screen edit + render with page overrides + dnd-kit | ✅ | `29a48bc` |
| (post-5.4) Per-template manifest folders + font-handling note | ✅ | `c8ba69c` |
| 5.5 Polish | ✅ | `8cce8c3` |
| 5.6 Dry-run iteration | ✅ | `9e06d77` |
| 5.7 Wrap-up | this commit | (this) |

### Templates supported

One. `Recently_Leased_IOS` (id `recently-leased-ios`), file
`templates/Recently_Leased_IOS.indd`.

Resolved tile count via runtime introspection: **6** (sample frames:
`tile_1_address`, `tile_2_address`, `tile_3_address`).

Adding a new template now requires no code changes — drop the .indd
into the repo-root `templates/` directory and create a sibling folder
under `dashboard/templates/<TemplateName>/` with a `manifest.json`.
The dashboard's manifest scanner picks it up on next module load.

### Render-time observations across the dry-run set

Bridge / plugin / dashboard all running on a warm InDesign session:

| Run | Template + variation | Wall | Bytes | Overrides applied |
|---|---|---|---|---|
| 5.4 verification | first 6, both overrides | 3.5 s | 273,175 B | page_title,page_tagline |
| 5.6 A | first 6, no overrides | 3.66 s | 273,416 B | (none) |
| 5.6 B | last 6, title only | 4.12 s | 279,226 B | page_title |
| 5.6 C | first 6 reversed, both | 3.64 s | 272,977 B | page_title,page_tagline |
| 5.6 F | first 6, whitespace overrides | 3.73 s | 273,219 B | page_tagline (see note) |

**Median wall ≈ 3.7 s, max ≈ 4.1 s.** Well within the Stage 4-era
budget. Plugin total time for a 6-tile render with both overrides
is ~2.5 s (1.7 s populate + 0.8 s export); the rest is HTTP +
fs.readFile + response framing.

### Open items for the user before scheduling Hannah

1. **Bridge / dashboard / InDesign cold-start** before the demo.
   Plugin is loaded via UXP DT (doesn't survive InDesign restarts),
   so a clean walk-through is: launch InDesign → load plugin → start
   bridge → start dashboard → visit `/`. No template needs to be
   open; `OpenOptions.openCopy` opens the file fresh per call.
2. **The whitespace-override edge case** (5.6 F) is documented but
   not fixed. UI prevents it; direct API callers can produce 3 spaces
   in a frame. Trivial fix when we want.
3. **`test-render.js` (CLI) is broken** because it hardcodes the old
   filename `templates/template-v2-test.indd` and the file was renamed
   to `Recently_Leased_IOS.indd` mid-Stage-5. Stage 5 prompt said
   don't touch the CLI; it's a one-line constant change to revive.
   Dashboard is the primary interface from here.
4. **Tag push.** `stage-5-complete` is created locally; will ask
   before pushing to origin.
5. **Demo flow for Hannah.** Recommend walking template → comps →
   edit, drag a tile, edit a page field, hit Render, scroll/download
   the preview. The split-screen layout makes the value clear quickly.

### Hannah-review readiness

| Capability | Status |
|---|---|
| Template selection with field-set chips and preview | ✓ |
| Comp filter + selection (gated to template's tile count) | ✓ |
| Drag-reorderable tile arrangement | ✓ |
| Page-level field editing with template defaults pre-populated | ✓ |
| Inline PDF preview after render | ✓ |
| Download PDF | ✓ |
| Re-render workflow with dirty-state hint | ✓ |
| Original template never modified (verified by SHA256) | ✓ |
| Error states surface bridge / plugin / validation issues | ✓ |
| Multi-template architecture in place (folder-per-template) | ✓ |

Ready for Hannah review.

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

## Stage 5.6 — Internal dry run

Six curl-driven scenarios against the live API: three happy paths
(different comp combinations and override sets) and three edge cases
(validation, unknown template, whitespace overrides).

### Results

| | Scenario | HTTP | Wall | Bytes | `X-Render-Applied-Overrides` |
|---|---|---|---|---|---|
| A | first 6, no overrides | 200 | 3.66 s | 273,416 | (none) |
| B | last 6 (mock-2..mock-7), title only | 200 | 4.12 s | 279,226 | `page_title` |
| C | first 6 reversed, both overrides | 200 | 3.64 s | 272,977 | `page_title,page_tagline` |
| D | 5 comps (validation) | 400 | — | — | `{"error":"validation failed","details":[{"field":"comps","message":"expected 6 comps (per tile_count), got 5"}]}` |
| E | unknown template_id | 404 | — | — | `{"error":"unknown template_id: nonexistent-template"}` |
| F | `title: ""` + `tagline: "   "` | 200 | 3.73 s | 273,219 | `page_tagline` (only) |

### Confirmations

- **Latency stays in the 3.6-4.1 s wall band** for every happy-path
  render. Within the Stage 4 expectations.
- **Different comp sets produce different bytes.** A (first 6) =
  273,416. B (last 6) = 279,226. C (first 6 reversed) = 272,977. So
  comp set + ordering both affect output, as expected.
- **Validation rejects cleanly.** D returns the exact
  "expected N comps (per tile_count), got M" message the new
  validator emits.
- **Manifest lookup rejects cleanly.** E returns the route's 404 with
  the unknown id echoed.
- **`app.documents.length === 0` after all 6 calls** — close path
  solid, no orphan docs.
- **Template SHA256 unchanged** across the 6 runs:
  `fc8f844c0ba707b06db0e9e73b118a053318387519813e0cc7b0ee2672ce010e`.
  The original `Recently_Leased_IOS.indd` is byte-identical before
  and after — `OpenOptions.openCopy` invariant intact.

### Rough edges

#### F — whitespace-only override is applied as 3-spaces (not blocked)

Sending `tagline: "   "` (three spaces) caused the route handler to
forward the override to the bridge, which dutifully replaced the
template's tagline with three space characters. The route's drop
condition is currently:

```ts
if (frame && value.length > 0) {
    bridgeOverrides.push({ frame, value });
}
```

`"   ".length === 3 > 0`, so it passes. The fix would be
`value.trim().length > 0`. The UI never lets this happen — the
edit-page Render button gates on `valueFor(field).trim().length > 0`
across all fields — so the issue only surfaces against direct API
callers.

**Decision:** **deferred**. The UI can't trigger it; a direct API
caller who types whitespace probably means it. Documented for
post-Hannah cleanup.

#### Page-fields error path — Render still enabled

If `/api/templates/[id]/page-fields` fails (bridge transient hiccup
between Comps stage and Edit stage), the edit-page surfaces a
destructive Card explaining the problem. The Render button stays
enabled, falling back to the template's defaults (no overrides
sent). This is the right behavior — let the user render rather than
block them entirely — but the helper text doesn't currently note it.
Acceptable for v1; could be a one-line UX tweak later.

#### `\r` in current_value of tagline read-back

The template's `page_tagline` frame contains a trailing `\r` (CR)
which the read-back endpoint returns verbatim. The text input
preserves it on edit. If the user clears the field and retypes, the
`\r` is dropped and a normal text run is sent on render — InDesign
handles either form. Not a defect, just a quirk worth knowing.

### Things deliberately NOT tested in the dry run

- **Multiple templates.** Manifest only has one entry. New templates
  will be tested when added.
- **Concurrent renders.** The bridge serializes via its queue
  (verified in Stage 2E). No new concurrency surface introduced in
  Stage 5.
- **Bridge-down / plugin-disconnected paths.** Already tested in
  Stage 4.5 / 4.6; nothing in Stage 5 changed those code paths
  meaningfully.

### Stage 5.6 status: pass

---
