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
