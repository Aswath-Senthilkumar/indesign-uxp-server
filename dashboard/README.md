# dashboard

Next.js 16 frontend for the InDesign automation system. Runs on port **4000**. Provides two distinct workflows: **Build** (team-sheet template rendering) and **BOV** (Broker Opinion of Value multi-step document).

## Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.2.4 | Framework (App Router) |
| React | 19.2.4 | UI |
| Tailwind CSS + shadcn | — | Styling + component primitives |
| @dnd-kit | — | Drag-and-drop comp ordering |
| pdf-lib | — | Client-side PDF merging for preview |
| @supabase/supabase-js | — | Comp data reads |

## Startup

```bash
cd dashboard
pnpm install     # or npm install
pnpm dev         # http://localhost:4000
```

Requires `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
RENDER_SERVICE_URL=http://127.0.0.1:8765   # optional, defaults to 8765
```

## App structure

```
app/
├── page.tsx                  Home — workflow selector
├── layout.tsx                Root layout
│
├── build/                    Build workflow (team sheets)
│   ├── workflow/page.tsx     Step 1: pick workflow
│   ├── template/page.tsx     Step 2: pick template
│   ├── comps/page.tsx        Step 3: pick + order comps
│   └── edit/page.tsx         Step 4: edit page fields + render
│
└── bov/                      BOV workflow
    ├── step/[step]/page.tsx  Dynamic step renderer (steps 1–7)
    └── complete/page.tsx     Final merged PDF download
```

## Workflows

### Build — team sheets

Linear 4-step flow:
1. Pick workflow
2. Pick template (fetches from render-service manifest registry)
3. Pick and order comps (drag-drop, from Supabase)
4. Edit page-level fields + trigger render → preview PDF

State managed by `lib/build-state.tsx` (React Context).

### BOV — Broker Opinion of Value

7-step linear flow. Each step renders one section of the BOV to a PDF. The preview pane shows a live merged PDF (cover + all completed sections) via `lib/use-merged-pdf.ts`.

| Step | Component | Section |
|------|-----------|---------|
| 1 | `bov-cover-step.tsx` | Cover page |
| 2 | `bov-section1-step.tsx` | Section 1: Similar Transactions + Exec Summary + Pricing |
| 3–7 | (pending) | Sections 2–6 |

State managed by `lib/bov-state.tsx` (React Context). Each step stores:
- `pdfUrl` — blob URL for preview
- `pdfBytes` — `Uint8Array` for merging
- `confirmed` — whether the step is locked
- `fieldValues` — serialisable field state (persists within session)

## API routes

Dashboard API routes are **thin proxies** to the render service. They handle file uploads (multipart staging) and forward to `RENDER_SERVICE_URL`.

```
app/api/
├── render/route.ts                     POST → /render  (team-sheet)
├── templates/[id]/
│   ├── introspect/route.ts             POST → /introspect
│   ├── preview/route.ts                GET  → /preview
│   └── page-fields/route.ts           GET  → /page-fields
├── images/[filename]/route.ts          Serves staged images
└── bov/
    ├── comps/route.ts                  GET comps from Supabase (server-side)
    ├── cover/render/route.ts           POST multipart → /bov/cover/render
    └── section1/render/route.ts        POST multipart → /bov/section1/render
```

### BOV API routes — what they do

`bov/cover/render/route.ts` and `bov/section1/render/route.ts` share a pattern:
1. Parse `multipart/form-data` from the browser
2. For image files: write to `output/` temporarily
3. For Supabase image URLs: download and write to `output/` temporarily  
4. Build a JSON body and `POST` to the render service
5. Stream the PDF response back to the browser
6. Clean up staged files in `finally`

## Key components

| Component | Purpose |
|-----------|---------|
| `bov-cover-step.tsx` | Cover step: property info, client name, cover photo |
| `bov-section1-step.tsx` | Section 1: 6 comp tiles, exec summary, pricing |
| `bov-comp-picker.tsx` | Modal overlay to pick a comp from the Supabase list |
| `bov-stepper.tsx` | BOV step navigation sidebar |
| `bov-step-view.tsx` | BOV step content router |
| `workflow-picker.tsx` | Home workflow selector |
| `template-picker.tsx` | Template selection with preview thumbnails |
| `comps-picker.tsx` | Build workflow comp drag-drop picker |
| `edit-render.tsx` | Build workflow edit + render pane |

## Key libraries

| File | Purpose |
|------|---------|
| `lib/bov-state.tsx` | React Context for BOV step state (bytes, fields, confirmed) |
| `lib/build-state.tsx` | React Context for Build workflow state |
| `lib/bov-steps.ts` | BOV step definitions (id, label, route) |
| `lib/use-merged-pdf.ts` | Hook: merges multiple `Uint8Array` PDFs using pdf-lib; version-counter pattern keeps deps array constant-length |
| `lib/format.ts` | `formatSfAc`, `Comp` type |
| `lib/comps.ts` | Supabase comp read helpers (server-side) |
| `lib/manifest.ts` | Template manifest loading + client-side cache |

## BOV rendering notes

- Each step renders its section independently via its own API route
- The preview merges all completed sections using `useMergedPdf([step1Bytes, step2Bytes, ...])`
- `pdf-lib` runs in the browser — no server round-trip for the merge
- Image staging: both file upload and Supabase URL images are staged to `output/` as temp files; the render service's bridge receives absolute paths
- Line endings in textareas: always normalise `\n` → `\r` (InDesign paragraph mark) in bridge code, and collapse `\r\r+` to prevent double-spacing
