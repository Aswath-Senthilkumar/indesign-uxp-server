# STAGE 4 NOTES

Standalone Next.js dashboard around the Stage 3 batched render pipeline.
Goal: get Hannah a usable web UI for picking 6 comps, hitting render, and
previewing the resulting PDF.

Companion to `STAGE-2-NOTES.md` and `STAGE-3-NOTES.md`. Same structure:
each sub-stage records what was done, key decisions, and anything worth
flagging for the post-Hannah review (Liam → Jon → Max).

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
