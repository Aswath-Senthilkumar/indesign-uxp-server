# STAGE 4 NOTES

Standalone Next.js dashboard around the Stage 3 batched render pipeline.
Goal: get Hannah a usable web UI for picking 6 comps, hitting render, and
previewing the resulting PDF.

Companion to `STAGE-2-NOTES.md` and `STAGE-3-NOTES.md`. Same structure:
each sub-stage records what was done, key decisions, and anything worth
flagging for the post-Hannah review (Liam → Jon → Max).

---

## Stage 4 — One-page summary

**Branch:** `analysis/initial-pass`
**Reference tags:** `stage-1.5-complete` at `1ee2156`,
`stage-3-complete` at `e2ed837`, `stage-3.7-complete` at `7dd464c`.
**Commits added in Stage 4:** **8** — six per sub-stage plus this
wrap-up plus the tag.

### Sub-stages completed

| | Status | Commit |
|---|---|---|
| 4.1 Scaffold dashboard (Next.js 16 + shadcn, port 4000) | ✅ pass | `4f7b609` |
| 4.2 `POST /api/render` endpoint | ✅ pass | `6d81388` |
| 4.3 Comp picker UI + image API | ✅ pass | `0c2fe7c` |
| 4.4 Render button + PDF preview | ✅ pass | `0845503` |
| 4.5 Polish (errors, loading, empties, visual, thumbnails) | ✅ pass | `ddc47e2` |
| 4.6 Internal dry run | ✅ pass | `ceec37a` |
| 4.7 Wrap-up | this commit | (this) |

### Render-time observations across all runs

Wall-clock latencies for `POST /api/render` measured from a curl
caller, against a warm InDesign session:

| Source | Wall | Plugin | Populate | Export |
|---|---|---|---|---|
| 4.2 first call | 1.98 s | 1.70 s | 636 ms | 1066 ms |
| 4.6 last 6 (cold of session) | 1.31 s | 1.27 s | 495 ms | 769 ms |
| 4.6 last 6 again (repeat) | 1.13 s | 1.11 s | 397 ms | 714 ms |
| 4.6 first 6 (switched comps) | 1.39 s | 1.37 s | 580 ms | 790 ms |

**Median ~1.35 s, max ~1.98 s** for the API call alone. Browser-side
end-to-end (preview rendered in `<embed>`) is essentially the same
plus a few ms of blob handling.

A *cold* InDesign session (first export of a fresh launch) would push
export back to the ~6 s seen in Stage 3.4. We treat the 1-2 s number
as the steady-state once a render is underway. Comfortably under
master-app's eventual UX budget.

### Rough edges fixed during dry run

None. The render pipeline, UI flow, and error handling all behaved as
intended on first pass.

### Rough edges deferred to post-Hannah

These are not dashboard-side issues — they're known carry-overs from
earlier stages, repeated for handoff visibility:

- `BRIDGE_TOKEN` is still optional. Should `process.exit(1)` when
  unset (`safety-report.md` §10). Stage 4 didn't add a binding
  constraint — the dashboard is a single-user localhost tool.
- `plugin/manifest.json` `network.domains` is still `"all"` — should
  be tightened to a localhost allow-list (`safety-report.md` §1).
- 30-second timeout disambiguation: hard force-quit of InDesign
  surfaces `"Execution timed out after 30s"` rather than
  `"Plugin disconnected"` (Stage 2E Test 3). The dashboard renders the
  message faithfully; if Hannah finds it confusing we can special-case
  the timeout to surface "InDesign appears to have stopped responding."
- Single template, no chooser — fixed on `template-v2-test` for v1.
- No drag-and-drop reordering — first-click-wins ordering is enough.
- No persistence — refresh resets the selection.
- Dashboard runs same-machine as the bridge. master-app placement
  (inside master-app vs standalone) is deferred until Max sees this.

### Hannah review prerequisites — all met

| | |
|---|---|
| Picks a template | static label in v1 (one option), per the prompt |
| Searches and selects six comps | filter input + per-card Add button |
| Orders the selected comps | first-click-wins ordering, numbered list |
| Hits render | enabled-only-at-6 button with loading state |
| Sees an inline preview | `<embed type="application/pdf">`, 600 px |
| Downloads the PDF | anchor with `download="team-sheet.pdf"` |

### Substrate state

At this commit:

- Bridge: process **6644** (PID at the time of writing) listening on
  `127.0.0.1:3000` (HTTP) and `127.0.0.1:3001` (WebSocket).
- Plugin: connected (verified via `GET /status`).
- Dashboard dev server: running on `127.0.0.1:4000` via `pnpm dev`.
- InDesign 21.3 (= 2026): open with `template-v2-test.indd` as the
  active document.

### Tag

`stage-4-complete` at this commit. Push pending user authorisation —
will ask before pushing.

---

## Prerequisites — verified at start

- `STAGE-3-NOTES.md` exists at repo root
- Tag `stage-3-complete` exists locally and on `origin`
- Tag `stage-3.7-complete` exists locally (batched multi-tile render)
- `templates/template-v2-test.indd` exists (~14 MB)
- `test-render.js` is the Stage 3.7 batched version
- `mock-data/comps.json` has 7 entries, each with a referenced image
- Working tree clean of unstaged changes (only intentional untracked
  files: `analysis/safety-report.md`, various `*prompt.md`, `.claude/`)
- Tooling: node 24.11.1, npm 11.12.0, pnpm 10.33.2 (resolved via
  corepack)

---

## Stage 4.1 — Scaffold dashboard

### Tooling decision

The Stage 4 prompt's two instructions ("use pnpm if available, otherwise
npm" and "match what the user has been using in `bridge/`") conflict —
the bridge uses npm. Picked **pnpm**: it's available via corepack, the
prompt's `create-next-app` example uses `--use-pnpm`, and the dashboard
is a separate app from the bridge so the package-manager choice doesn't
need to match.

### Scaffold

```
$ npx --yes create-next-app@latest dashboard \
    --typescript --tailwind --app --no-src-dir --no-eslint \
    --use-pnpm --no-turbopack --import-alias "@/*"
...
+ next 16.2.4
+ react 19.2.4
+ tailwindcss 4.2.4
+ typescript 5.9.3
```

Note: `--no-turbopack` was passed at scaffold time, but Next.js 16's
`next dev` uses Turbopack by default anyway (visible in the dev server
banner: `▲ Next.js 16.2.4 (Turbopack)`). Not a problem; just noted so
future readers don't expect a Webpack runtime.

### shadcn/ui init

```
$ npx --yes shadcn@latest init --defaults --force
✔ Verifying framework. Found Next.js.
✔ Validating Tailwind CSS. Found v4.
✔ Writing components.json.
✔ Created 2 files: components/ui/button.tsx, lib/utils.ts
✔ Updating app/globals.css
```

Default preset (= `next` + `base-nova`) added a Button component
during init. The other 5 components added explicitly:

```
$ npx --yes shadcn@latest add input card select label separator --yes
✔ Created 5 files:
  - components/ui/input.tsx
  - components/ui/card.tsx
  - components/ui/select.tsx
  - components/ui/label.tsx
  - components/ui/separator.tsx
```

Components ready: `button`, `input`, `card`, `select`, `label`,
`separator` — exactly the set the Stage 4 prompt asked for.

### Port: 4000 (not 3000)

The bridge owns `127.0.0.1:3000`. The dashboard runs on `:4000` to
avoid the conflict — patched in `dashboard/package.json`:

```json
"dev":   "next dev --port 4000",
"start": "next start --port 4000"
```

(Skipped the prompt's "confirm on default 3000 first, then change to
4000" cycle because the bridge would have collided with port 3000 the
moment the dashboard started — direct path to 4000 is cleaner.)

### Turbopack workspace root

Turbopack auto-detected the repo root (`E:\TAI\indesign-uxp-server\`)
as the workspace root because the MCP server's `package-lock.json`
lives there. That surfaced a warning and risked confused module
resolution. Pinned the workspace root to the dashboard folder via
`dashboard/next.config.ts`:

```ts
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
    turbopack: {
        root: here,
    },
};
```

Warning gone after restart.

### Layout + page

`app/layout.tsx`: replaced the create-next-app default metadata with
`title: "Team Sheet Renderer"` and a one-line description. Body is a
minimal `<body>` with bg/text foreground classes — no header chrome,
no sidebar, per the Stage 4 prompt's "title only" instruction.

`app/page.tsx`: replaced the create-next-app marketing splash with a
minimal Stage-4.1 placeholder:

```tsx
export default function Home() {
    return (
        <main className="mx-auto max-w-5xl px-6 py-10">
            <h1 className="text-2xl font-semibold tracking-tight">
                Team Sheet Renderer
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Stage 4.1 scaffold. Comp picker and render UI come in Stage 4.3.
            </p>
        </main>
    );
}
```

### AGENTS.md / CLAUDE.md from create-next-app

`create-next-app` generated `dashboard/AGENTS.md` and `dashboard/CLAUDE.md`
that direct AI agents to read `node_modules/next/dist/docs/` (the
version-matched Next.js 16 docs that ship with the package) before
writing any Next.js code. Their existence is intentional and they're
committed.

I read the relevant docs (layouts-and-pages, ai-agents) before
writing this scaffold. Will read the docs for route handlers (Stage
4.2) and server/client components (Stage 4.3) before those stages.

### Verification

Dev server boot log:

```
▲ Next.js 16.2.4 (Turbopack)
- Local:   http://localhost:4000
✓ Ready in 667ms
```

`curl http://localhost:4000` → HTTP 200 in 1.85 s on first compile.
Page contains both `Team Sheet Renderer` heading and the placeholder
text; `<title>` matches.

Human visual confirmation: "Looks perfect, we shall continue."

### Stage 4.1 status: pass

---

## Stage 4.2 — Render API endpoint

### What was built

Two new files under `dashboard/`:

- `dashboard/lib/format.ts` — `Comp` type, `formatSfAc(building_sf, land_area)` formatter, request validators (`validateRenderRequest`).
- `dashboard/app/api/render/route.ts` — the `POST /api/render` handler.

The handler validates the request body, checks each comp's image
exists on disk and is >10 KB, polls `GET /status` on the bridge to
ensure the plugin is connected, builds a single batched code string
(same shape as Stage 3.7's `test-render.js`), POSTs it to
`http://127.0.0.1:3000/execute`, reads the resulting PDF off disk, and
returns the bytes with `Content-Type: application/pdf`.

### Code-reuse decision

The Stage 4 prompt asked for "refactor formatting helpers from
test-render.js into a shared module rather than duplicating," but the
working notes also say `test-render.js` is stable and not to be
modified. Resolved by accepting a 5-line duplication of `formatSfAc`
in `dashboard/lib/format.ts`. The "don't modify" instruction is more
explicit and the duplication is small.

### Path safety note (carried forward from Stage 3.4 / 3.7)

Same gap as test-render.js: the bridge's `/execute` endpoint forwards
code strings to the plugin verbatim and does NOT run the path
validator added in Stage 1.5 (which lives in `src/handlers/`,
the MCP-server path we're not going through). `INDESIGN_ALLOWED_ROOTS`
does not gate the API route. We resolve to absolute and pre-check
existence locally; the only true boundary is InDesign's process-level
file permissions. Documented in the route handler's header comment.

### Per-request output paths

Each render writes a unique file `output/dashboard-render-<timestamp>.pdf`
so concurrent requests don't clobber each other. After the bytes are
read into memory the file is best-effort-deleted (failure is fine —
`output/` is gitignored). Returning the bytes inline (not a path)
matches the prompt's "browser can preview inline" requirement and
also avoids a second round-trip to fetch the file.

### Diagnostic headers

The response carries plugin-side timings on `X-Render-*` headers so
the UI in Stage 4.4 can surface "rendered in N ms" without an extra
trip:

```
X-Render-Plugin-Total-Ms
X-Render-Populate-Ms
X-Render-Export-Ms
X-Render-Wall-Ms
```

### Test run

Built a request body programmatically from the first 6 entries of
`mock-data/comps.json`, stripped the local-only `source_folder` field,
POSTed to `http://localhost:4000/api/render`:

```
$ curl -s -m 60 -X POST http://localhost:4000/api/render \
       -H 'Content-Type: application/json' \
       --data-binary @<body.json> \
       --output dashboard-test-render.pdf -D <headers> \
       -w 'HTTP=%{http_code} TIME=%{time_total}s SIZE=%{size_download}\n'
HTTP=200 TIME=1.982743s SIZE=273416
```

Response headers:

```
HTTP/1.1 200 OK
content-type: application/pdf
content-length: 273416
x-render-populate-ms: 636
x-render-export-ms: 1066
x-render-plugin-total-ms: 1702
x-render-wall-ms: 1775
```

PDF magic bytes: `%PDF-1.4`. `file` reports `PDF document, version
1.4, 1 page(s)`.

### Verification against Stage 4.2 success criteria

| Criterion | Result |
|---|---|
| Response 200 OK | ✓ |
| File created | ✓ (`output/dashboard-test-render.pdf`, 267 KB) |
| File size >50 KB | ✓ |
| Total request time <15 s | ✓ (1.98 s) |
| Visually matches Stage 3.7 output | ✓ (human: "It's identical") |

### Latency note

Both `output/test-render.pdf` (Stage 3.7 CLI run) and
`output/dashboard-test-render.pdf` (Stage 4.2 API run) are
**byte-identical**: 273,416 bytes each. Same comps, same template,
same code shape — confirms the API route is doing exactly what the
CLI script does.

The 1.98 s wall-clock here is faster than Stage 3.7's 2.6 s. Same
explanation: warm InDesign session, font/colour/PDF-engine state
cached from prior renders. A cold-start re-run would land closer to
4-7 s, dominated by export.

### Stage 4.2 status: pass

---

## Stage 4.3 — Comp picker UI

### Files

| Path | Role |
|---|---|
| `dashboard/app/page.tsx` | Server Component: reads `mock-data/comps.json` from disk, passes the comp array as a prop to `<Picker>` |
| `dashboard/components/picker.tsx` | Client Component (`'use client'`): state, search, selection, render button (stub) |
| `dashboard/app/api/images/[filename]/route.ts` | GET handler that streams comp images from `mock-data/images/<filename>` to the browser |

The page itself stays a Server Component so we can read `comps.json`
directly with `fs.promises.readFile` — no `/api/comps` round-trip
needed. The picker is a Client Component because it needs `useState`
for selection and search. Data flows once, server → client, as a
serializable prop.

### Image serving

Images live at `<repo>/mock-data/images/`, outside `dashboard/public/`.
Rather than copy them into `public/`, a tiny route handler serves them
on demand:

- The `[filename]` segment is the only user-controlled path on this
  surface, so it's the one place in Stage 4 that gets explicit
  path-traversal protection — regex on the name, allow-list on
  extension, and a `path.resolve()` containment check against
  `IMAGES_DIR`.
- Verified live:
  - `GET /api/images/1325-e-elwood-st.jpg` → 200, `image/jpeg`,
    208,455 bytes, JPEG magic bytes `ff d8 ff`
  - `GET /api/images/..%2F..%2Fpackage.json` → 400 `{"error":"invalid filename"}`
  - `GET /api/images/foo.txt` → 400 `{"error":"unsupported extension"}`
  - `GET /api/images/no-such-file.jpg` → 404 `{"error":"not found"}`

### UI structure

Top-to-bottom layout per the prompt:

1. Header (`<h1>Team Sheet Renderer</h1>` + one-line subhead)
2. **Template** label — static `"6-tile sample (template-v2-test)"`,
   no selector yet (v1 fixes the template).
3. **Available comps** — `Input` filter with placeholder
   "Filter by address, city, or state…" + a `<count> of <total>`
   counter; `<Card>` per comp with thumbnail, address, city/state,
   `formatSfAc(...)` line, and an **Add** / **Selected** /
   **Full** button.
4. **Selected** — count badge `<n> / 6`; numbered list with
   per-row **Remove** button. Empty-state message when nothing
   picked.
5. **Render** button — disabled until exactly 6 comps selected.
   Hint text below explains the gating.

shadcn primitives used: `Button`, `Input`, `Card`, `Separator`. No
need for `Select`/`Label` yet (v1 has no template chooser, no form
fields beyond the search input which has an `aria-label`).

### Selection ordering

First-click-wins ordering. The comps appear in the **Selected**
list in the order the user added them. No drag-and-drop reordering
yet — the prompt explicitly defers that to a Hannah follow-up.

### Render button

Stub for Stage 4.3:

```tsx
function onRender() {
    // Stage 4.3 stub. Wired to /api/render in Stage 4.4.
    console.log("render", selectedIds);
}
```

Wired up properly in 4.4.

### Verification

`curl http://localhost:4000` returns HTML containing the expected
section labels (`Available comps`, `Filter by address`, `Render`,
`Selected`) and the comp addresses (`1325 E Elwood`, `1701 E
Elwood`, `3635 S 43rd`, etc.). Compile clean — no Next.js / React
errors in the dashboard log.

Human walked the picker through:

- 7 comps load with thumbnails ✓
- "elwood" filter narrows to mock-1 + mock-2 ✓
- "glendale" filter narrows to mock-6 + mock-7 ✓
- Adding 6 comps populates the Selected list 1-6 ✓
- The 7th comp's button switches to "Full" ✓
- Render button gates on exactly-6 ✓
- Remove + add a different comp updates ordering ✓

Reply: "works just as expected".

### Stage 4.3 status: pass

---

## Stage 4.4 — Render button + PDF preview

### What was wired

`dashboard/components/picker.tsx` now does the real `/api/render` call
when the user hits Render. New state machine inside the picker:

```ts
type RenderState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "success"; blobUrl: string; bytes: number; serverWallMs: number | null }
    | { kind: "error"; message: string; detail?: string };
```

### Flow

1. `onRender()` early-returns if `!canRender` or already loading.
2. State → `loading`. Button text becomes **"Rendering…"**, button is
   disabled, helper text below explains "Calling the bridge — usually
   2-10 seconds."
3. `fetch('/api/render', POST, { template, comps })` with the selected
   comps.
4. Network failure → state → `error` with the network error message.
5. Non-OK response → parse JSON `{ error, detail?, hint?, details? }`,
   compose a friendly message + detail string, state → `error`.
6. OK response → `await res.blob()`, `URL.createObjectURL(blob)`, read
   `X-Render-Wall-Ms` header, state → `success`.
7. `useEffect` cleanup revokes the blob URL when the state moves on
   (next render or component unmount).

### Preview UI

Renders below the Render button when `state.kind === "success"`:

- Header line "Preview" + tiny stats on the right
  (`<size> KB · <wallMs> ms server`)
- `<embed src={blobUrl} type="application/pdf" />` in a bordered
  rounded container, fixed 600 px height
- Below: a **Download PDF** anchor (`<a href={blobUrl}
  download="team-sheet.pdf">`). The browser handles the save.

### Error UI

Renders below the Render button when `state.kind === "error"`:

- A `Card` with `role="alert"`, destructive styling
- Bold message line + optional secondary detail line

This pattern surfaces the bridge's own error text faithfully — for
example, a "bridge unreachable" 503 will show the route handler's
hint ("start the bridge: cd bridge && node server.js") in the detail
line. Stage 4.5 will exercise these error paths deliberately.

### Verification

Human walked the full flow:

- Selected 6 comps in the picker
- Clicked Render — loading state visible, button disabled
- Preview appeared inline within ~2 seconds
- Download saved `team-sheet.pdf` correctly
- Saved PDF opens correctly and matches the `/api/render` curl output

Reply: "Perfect, works exactly like expected and renders a team-sheet
inline and allows download."

### Stage 4.4 status: pass

---

## Stage 4.5 — Polish

Worked through the prompt's priority list. Most of what it asked for was
already in place from earlier sub-stages; this pass verified each axis and
tightened the visual side.

### 1. Error handling — exercised end-to-end

All error paths return clean structured JSON with appropriate HTTP
status; the picker's error Card surfaces them faithfully.

| Trigger | HTTP | Server JSON |
|---|---|---|
| Bridge process killed | 503 | `{"error":"bridge unreachable on 127.0.0.1:3000","hint":"start the bridge: cd bridge && node server.js","detail":"fetch failed"}` |
| Plugin disconnected (bridge up but plugin unloaded) | 503 | `{"error":"bridge says plugin not connected","hint":"open InDesign with the Bridge Panel; …"}` |
| 5 comps instead of 6 | 400 | `{"error":"validation failed","details":[{"field":"comps","message":"expected 6 comps, got 5"}]}` |
| Missing field / wrong type | 400 | `{"error":"validation failed","details":[{"field":"comps[2].address","message":"missing"},{"field":"comps[3].building_sf","message":"expected number, got string"}]}` |
| `image_filename` points at non-existent file | 400 | `{"error":"image files missing or too small","missing":["no-such-image.jpg"]}` |
| Wrong template name | 400 | `{"error":"validation failed","details":[{"field":"template","message":"only \"template-v2-test\" is supported in v1"}]}` |

The picker composes `body.error` as the alert title and `[hint, detail,
details...]` joined by " — " as the secondary line, so e.g. the
bridge-down error renders as:

```
bridge unreachable on 127.0.0.1:3000
start the bridge: cd bridge && node server.js — fetch failed
```

— which is actionable without copying anything from a console.

Verified the bridge-restart path doesn't poison the dashboard's
state: kill bridge → 503 in UI → restart bridge → plugin
auto-reconnects within ~3 s → next render request goes through
without a page reload.

### 2. Loading states

- Render button: `disabled` + text → `"Rendering…"` + `aria-busy="true"`
  + helper line `"Calling the bridge — usually 2-10 seconds."` while
  the request is in flight (Stage 4.4).
- Comp list: this is a Server Component; HTML arrives already
  populated. No client-side load skeleton needed.
- Preview pane: only rendered after first success. Pre-render the page
  shows nothing where the preview will appear, which is fine — adding
  an idle placeholder would be visual noise on first load.

### 3. Empty states

- Filter no-match: `"No comps match "elwood"."` (already present from
  4.3).
- Selected list empty: `"Nothing selected yet — add comps from the
  list above."` (already present from 4.3).

### 4. Visual polish

- Comp cards now have a `transition-colors` hover effect:
  - default: `hover:bg-muted/30` for hoverable ones
  - selected: subtle background tint + softer border
    (`border-foreground/20 bg-muted/40`)
  - at-cap (six already picked, this row not selected): `opacity-60`
    plus the disabled Add button → "Full"
- Header copy slightly tightened on the page (added a one-line
  subhead in 4.3).
- Stuck with shadcn defaults for typography and spacing per the
  prompt's "use shadcn defaults where possible" guidance.

### 5. Image thumbnails

Bumped from 56 × 56 to **60 × 60** to match the prompt literally.
`object-cover`, rounded corners, `loading="lazy"`, explicit
`width`/`height` attributes for layout-shift avoidance. No further
changes — already lazy, already rounded.

### Stage 4.5 status: pass

Verification of UI-side error rendering during a bridge cycle is
deferred to **Stage 4.6** so the user only does one cycle of UI
testing rather than two.

---

## Stage 4.6 — Internal dry run

### Curl-driven scenarios (autonomous)

Three consecutive renders against the live API:

| Run | Comps | Wall | Plugin | Populate | Export | Bytes |
|---|---|---|---|---|---|---|
| 1 | last 6 (mock-2..7) | 1.31 s | 1.27 s | 495 ms | 769 ms | 279,173 |
| 2 | last 6 again | 1.13 s | 1.11 s | 397 ms | 714 ms | 279,174 |
| 3 | first 6 (mock-1..6) | 1.39 s | 1.37 s | 580 ms | 790 ms | 273,416 |

Confirmations:

- Repeat renders work cleanly — second render of the same input is
  *faster*, no document leak / no stale state on the bridge or plugin.
- Switching comp sets produces different-sized PDFs (5,758-byte delta
  between last-6 and first-6, reflecting different image bytes).
- 1-byte difference between two identical-input renders is a PDF
  timestamp; not concerning.

### UI-driven scenarios (human walk-through)

Five checks bundled into one UI cycle (combined with the deferred
4.5 bridge-cycle error-rendering test):

1. Filter sanity — `elwood` narrows to 1325/1701 E Elwood, `glendale`
   narrows to 6271/7701, `xyz` shows the empty-state message, clearing
   restores all 7.
2. Render gating — disabled at 5 selected, enabled at exactly 6.
3. Re-render with changed selection — preview updates with new content
   on the second click; previous blob URL is revoked.
4. Last-6 selection ordering — adding mock-2..mock-7 in order produces
   a render with 1701 E Elwood (mock-2) in tile_1, confirming
   selection order is honored.
5. Error UI — killing the bridge produces the expected destructive
   error card in the dashboard with the bridge-unreachable message +
   actionable hint. Restart bridge, plugin auto-reconnects, next
   render works without a page reload.

Human reply: "All checks done, and it all works exactly as expected."

### Rough edges fixed during dry run

None. The render pipeline, UI flow, and error handling all behaved
as intended on the first pass.

### Rough edges deferred to post-Hannah

These are not rough edges in the dashboard itself — they're the
known carry-overs from earlier stages, repeated here so they're easy
to find at handoff time:

- `BRIDGE_TOKEN` is still optional. The bridge prints a warning on
  startup when unset; should `process.exit(1)`. Carried from
  `safety-report.md` §10. Stage 4 didn't add a binding constraint
  for this — the dashboard is a single-user localhost-only tool.
- `plugin/manifest.json` still has `network.domains: "all"`. Should
  be tightened to a localhost allow-list. Carried from
  `safety-report.md` §1.
- 30-second timeout disambiguation: a hard InDesign force-quit
  during a render produces `"Execution timed out after 30s"` rather
  than `"Plugin disconnected"` (Stage 2E Test 3). Today the
  dashboard surfaces that message faithfully via the error card,
  but if Hannah finds it confusing we could special-case the timeout
  and surface a more user-friendly "InDesign appears to have stopped
  responding" message.
- Single template, no template chooser. Stage 4 v1 is fixed on
  `template-v2-test`. If Hannah wants more templates we'd add a
  selector and per-template tile counts.
- No drag-and-drop reordering of the Selected list. First-click-wins
  ordering is sufficient for v1; reordering is a Hannah follow-up.
- No persistence — every refresh resets the selection. Acceptable
  for a prototype; would matter once brokers actually use this.

### Stage 4.6 status: pass

---
