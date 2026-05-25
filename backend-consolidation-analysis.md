# Backend Consolidation & BOV-Readiness Analysis

Read-only analysis dated 2026-05-16 against branch `analysis/initial-pass` at HEAD `972847e`. Goal: define the durable boundary between the production backend, the scaffolding that surrounds it, and the seam where BOV-specific code will land alongside team-sheet code without entangling them.

This document recommends; it does not act. A later implementation pass turns "Ordered next steps" into scoped tasks.

---

## 1. Executive recommendation

**The production backend is three directories: `bridge/`, `plugin/`, `render-service/`.** They run together on the Mac (bridge on `127.0.0.1:3000` + `:3001`, render service on `127.0.0.1:8765`, plugin loaded into InDesign via UXP). Behind a Tailscale Funnel only the render service is exposed publicly. The bridge is the local-loopback HTTP/WS gateway to the plugin; the plugin is the in-InDesign UXP panel that evaluates the bridge's `execute` payloads.

**Render-service contains zero code-level imports from `dashboard/`** — every `dashboard`-related reference in the service is either a comment, a `dashboard/.env.local` copy instruction in the README, or a default value for the configurable `TEMPLATE_MANIFEST_DIR` env var (which points at `dashboard/templates/` purely because the manifest JSON folders were left there during Phase 1). Phase 1's split between dashboard and render-service is therefore code-clean; the only residue is the manifest *file-system* path. **Fix that one path before BOV starts and the dashboard can be retired without touching production.**

**Repo cleanup that should happen before BOV:** (a) the original MCP-server stack (root `package.json`, `index.js`, `src/`, `tests/`, `docs/`) is dead — superseded by Phase 1's split and unused by the deployed backend; (b) the Next.js dashboard (`dashboard/`) was kept as a local test client and is now superseded by master-app's UI — flag for retirement; (c) `.indd` templates are gitignored at the repo root, which means a fresh clone has no templates to render — either un-gitignore them or document an out-of-band delivery story before the Mac deploy.

**The team-sheet / BOV seam should be a `core/ + teamsheet/ + bov/` split inside `render-service/`.** The substrate (bridge client, Supabase access, manifest loader, image staging, the field-agnostic bridge code in `render-script.mjs`, template introspection) becomes `core/` and is shared. Workflow-specific code (the `address|city_state|sf_ac|price|status|photo` resolver, the team-sheet formatters, the `comp_ids[] + page_overrides + tile_overrides` validator) consolidates under `teamsheet/`. `bov/` starts as a stub with a README and an empty routes folder, to be populated when BOV development begins. The HTTP API stays backward-compatible by keeping the existing flat team-sheet paths (`/render`, `/introspect`, `/page-fields`, `/preview`) and adding `/bov/*` alongside them. This is the BOV-ready boundary; everything below this section is the evidence and the detailed mapping.

---

## 2. Production backend inventory (§A)

What the deployed Mac actually needs to render a team sheet end-to-end. Every item below is keep / production.

### 2.1 Runtime processes

| Process | Source | Listens / runs on | Started by | Purpose |
|---|---|---|---|---|
| **Bridge** | [`bridge/server.js`](bridge/server.js) | HTTP `:3000`, WS `:3001` (loopback) | `cd bridge && node server.js` | HTTP-to-WebSocket gateway; serializes `/execute` calls into the plugin one-at-a-time; queues requests; 30s timeout; optional `BRIDGE_TOKEN` auth |
| **UXP plugin** | [`plugin/index.js`](plugin/index.js) + [`plugin/index.html`](plugin/index.html) + [`plugin/manifest.json`](plugin/manifest.json) | inside InDesign | UXP Developer Tool (manual load) | Receives `execute` messages over WS, evaluates the JS string in InDesign DOM context via `new Function('app', code)`, replies with the serialized result |
| **Render service** | [`render-service/server.js`](render-service/server.js) | HTTP `:8765` (loopback) | `cd render-service && node server.js` | Express app exposing `/status`, `/introspect`, `/page-fields`, `/preview`, `/render`. The single client of the bridge; owns Supabase reads, image staging, template manifest, PDF lifecycle |

### 2.2 Files required at runtime

| Group | Files | Why required |
|---|---|---|
| **Bridge** | [`bridge/server.js`](bridge/server.js), [`bridge/package.json`](bridge/package.json), `bridge/node_modules/` (`express`, `ws`, `uuid`) | The bridge process |
| **Plugin** | [`plugin/manifest.json`](plugin/manifest.json), [`plugin/index.html`](plugin/index.html), [`plugin/index.js`](plugin/index.js) | UXP entry; bridge cannot talk to InDesign without this loaded |
| **Render service entry** | [`render-service/server.js`](render-service/server.js), [`render-service/config.js`](render-service/config.js), [`render-service/package.json`](render-service/package.json), `render-service/node_modules/` (`express`, `@supabase/supabase-js`, `dotenv`) | The service process |
| **Render service routes** | All 5 files in [`render-service/routes/`](render-service/routes/) | The HTTP endpoints |
| **Render service lib** | All 13 files in [`render-service/lib/`](render-service/lib/) | Bridge client, Supabase, manifest, image fetch, formatters, validators, the bridge code generator, render orchestration |
| **Service config** | `render-service/.env` (created from `render-service/.env.example`) | Holds `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `BRIDGE_URL`, `PORT`, `SERVICE_TOKEN`, `INDESIGN_REPO_ROOT`, `TEMPLATE_MANIFEST_DIR`. Gitignored. **Already contains live values in this working tree — flagged in §6** |
| **Templates (.indd)** | `templates/6_Tile_Defaults.indd`, `templates/18_Tile_Price_Status.indd`, plus future BOV `.indd` | The render service `place()`s these into `OpenOptions.openCopy` and exports PDF. **All currently gitignored — flagged in §6** |
| **Template manifests** | `dashboard/templates/team-sheets/6_Tile_Defaults/manifest.json` + sibling for `18_Tile_Price_Status`, plus `dashboard/templates/bov/` (empty placeholder today) | Manifest registry source. `TEMPLATE_MANIFEST_DIR` defaults to this path. The folder being *under* `dashboard/` is incidental — Phase 1 left it there to avoid moving files |
| **Bridge code generator** | [`render-service/lib/render-script.mjs`](render-service/lib/render-script.mjs) | Built into the JS payload sent to the bridge per render. Field-agnostic; consumed inside the plugin via `Function('app', code)` |
| **Output dir** | `output/` (the service creates `output/working/render-{ts}-{hex}/` per render and unlinks on completion) | PDF byte staging |

### 2.3 Entry-point summary

A clean deploy / restart is:

```
cd bridge && npm install && node server.js          # terminal 1
cd render-service && npm install && node server.js  # terminal 2
# in InDesign: UXP Developer Tool → load plugin/ → Show Panel
```

No build step. No bundler. Plain ESM Node + plain UXP. Auto-restart on file change is available via `node --watch server.js` (dev only).

---

## 3. Scaffolding / superseded / test-only (§B)

### 3.1 The critical question: does the production backend depend on `dashboard/`?

**No. Zero code imports from `dashboard/` exist anywhere in `render-service/`, `bridge/`, or `plugin/`.** Grep of `dashboard` across `render-service/` returns only:
- Comments noting "mirrors `dashboard/lib/format.ts`" or "moved from `dashboard/lib/render-script.mjs`" — historical breadcrumbs, not imports ([`render-service/lib/format.js:4`](render-service/lib/format.js#L4), [`render-service/lib/render-script.mjs:5`](render-service/lib/render-script.mjs#L5), [`render-service/lib/manifest.js:8`](render-service/lib/manifest.js#L8))
- The `TEMPLATE_MANIFEST_DIR` default in [`render-service/config.js:45`](render-service/config.js#L45), which is an env-overridable filesystem path string — not an import
- README mentions of "copy values from `dashboard/.env.local`" — operator instruction, not a runtime dependency

The dashboard's API routes go the *other* direction: they are thin proxies that fetch from `${RENDER_SERVICE_URL}` ([`dashboard/app/api/render/route.ts:97`](dashboard/app/api/render/route.ts#L97), [`dashboard/app/api/templates/[id]/introspect/route.ts:22`](dashboard/app/api/templates/[id]/introspect/route.ts#L22), [`dashboard/app/api/templates/[id]/page-fields/route.ts:22`](dashboard/app/api/templates/[id]/page-fields/route.ts#L22), [`dashboard/app/api/templates/[id]/preview/route.ts:37`](dashboard/app/api/templates/[id]/preview/route.ts#L37)). The dashboard is a client of the render service; the render service does not know the dashboard exists.

**One soft coupling remains:** `TEMPLATE_MANIFEST_DIR` defaults to `<repo>/dashboard/templates` ([`render-service/config.js:45`](render-service/config.js#L45)). Override the env var at deploy time (or move the manifests out of `dashboard/`) and the dashboard can be deleted with no production impact. This is the single concrete blocker to retiring the dashboard, and it's a one-line config change.

### 3.2 Classification table

| Path | Class | Evidence | Recommendation |
|---|---|---|---|
| `bridge/` | **Keep (production)** | Process required at runtime | Keep as-is |
| `plugin/` | **Keep (production)** | Required InDesign-side | Keep as-is |
| `render-service/` | **Keep (production)** | Process required at runtime | Keep; restructure per §4 |
| `templates/*.indd` | **Keep (production)** | Render targets | Keep, but resolve gitignore issue (§6) |
| `dashboard/templates/<workflow>/<template>/manifest.json` | **Keep (production data)** | Manifest source; `TEMPLATE_MANIFEST_DIR` points here | Keep the content; **move out of `dashboard/` to e.g. `template-manifests/` or `render-service/templates/` so retiring the dashboard doesn't move production data** |
| `dashboard/` (Next.js app excluding the manifest folders above) | **Quarantine / retire** | Was the original UI; now superseded by master-app per Phase 2. Render service does not import any code from here. Local test client value only | Recommend: keep through one BOV cycle as a local sanity-check UI, then delete. Don't ship to the Mac |
| `dashboard/app/api/*` proxy routes | **Quarantine / retire** | Thin proxies; useful only when calling the render service from the dashboard UI | Deletes with the dashboard |
| `dashboard/components/*`, `dashboard/lib/*` (non-manifest) | **Quarantine / retire** | UI only | Deletes with the dashboard |
| `src/` (original MCP server: `core/`, `handlers/`, `types/`, `utils/`) | **Retire** | The pre-Phase-1 MCP server. Not imported by `render-service/`, `bridge/`, or `plugin/`. Root `package.json` (`main: "src/index.js"`) still points here, but nothing in the production stack runs it. Prior `analysis/safety-report.md` already recommends deletion under its "Option C" | Recommend: delete `src/`, `index.js` (the root redirect into `src/`), and the root `package.json`+`package-lock.json` (they describe `indesign-mcp-server` v2, not this project anymore) |
| `tests/` (23 integration tests for the MCP server) | **Retire with `src/`** | Tests target `src/index.js` (`spawn('node', ['src/index.js'])`); only meaningful with the MCP server present | Delete alongside `src/` |
| `docs/CHANGELOG.md`, `docs/LLM_PROMPT.md`, `docs/MCP_INSTRUCTIONS.md` | **Retire** | Describe the original MCP server | Archive or delete |
| `README.md` (root) | **Rewrite** | Describes the original MCP server's tool catalog | Rewrite to describe the bridge + render-service + plugin trio. Out of scope for this analysis; flag as a next-step |
| `LICENSE`, `CONTRIBUTING.md` | **Keep** | Project metadata | Keep |
| `mock-data/comps.json` + `mock-data/images/*` | **Archive** | Pre-Supabase test fixtures (7 hand-picked comps). The legacy `/api/images/[filename]` dashboard route serves from here ([`dashboard/app/api/images/[filename]/route.ts:22`](dashboard/app/api/images/[filename]/route.ts#L22)); not used by render-service | Keep around as a fallback if Supabase is unreachable for testing; not for production |
| `test-render.js` (repo root) | **Archive or keep as local smoke test** | Imports `./render-service/lib/render-script.mjs`; runs a one-off render without going through the HTTP service. Useful as a dev smoke test | Keep with a comment marking it dev-only |
| `output/*.pdf` | **Safe to remove** | Old test artifacts; the service writes to `output/working/...` and cleans up | Delete; `.gitignore` already excludes `output/` |
| `templates/working/` (the BOV rename-pass scratch) | **Archive** | Working copies + safety snapshots from the BOV rename pass | Move under `templates/.scratch/` or delete after the BOV rename pass closes |
| `analysis/findings.md`, `analysis/safety-report.md` | **Keep — reference** | Prior read-pass against the original repo state. Still useful context | Keep |
| `phase-1-backend-separation.md`, `phase-2.md`, `phase1-report.md`, `phase3-tile-overrides-report.md`, `STAGE-*-NOTES.md`, `repo-analysis-report.md`, `repo_analysis.md`, `changes.2026-03-06.md`, `stage-2-report.md` | **Archive** | History of past phases. Useful for context; not load-bearing | Move under `docs/history/` so the repo root isn't dominated by historical reports |
| `prompts/*` | **Keep** | User's per-phase prompt scratch (now versioned). Includes this analysis prompt | Keep |
| `scripts/bov-*.mjs` + `scripts/renames/*` | **Keep — BOV pass artifacts** | Built during the in-progress BOV rename pass | Keep through BOV rollout; consider moving under `tools/bov-rename/` later |
| `.planning/*.md` | **Undetermined — recommend archive** | Roadmap notes dated 2026-02-26 per `analysis/findings.md`; possibly stale | Inspect; if stale, archive |
| `TODO.md` (root) | **Keep** | Live BOV rename TODO captured during the page-by-page pass | Keep |

### 3.3 The dashboard-dependency call-out (the headline of this section)

**Production backend currently imports from `dashboard/`: NO.**

**Production backend currently reads files from `dashboard/templates/`: YES**, but only because `TEMPLATE_MANIFEST_DIR` defaults there. One env var (or one folder move) breaks this last tie. **This is the top thing to fix before BOV**, per the analysis-prompt's instruction.

### 3.4 Undetermined items (flagged for human review)

- `mock-data/build-comps.cjs` — referenced indirectly in `.gitignore` ("Mock-data: keep `comps.json` and `images/`, ignore raw per-comp source folders and the build helper script"). Whether it's still functional and useful is undetermined.
- The handful of test fixtures in `mock-data/<address>/` directories (gitignored) — appear to be raw per-comp source folders the build helper consumes. Undetermined whether they should be preserved or repopulated from Supabase if the helper is ever rerun.

---

## 4. Shared vs workflow-specific seam (§C) — the BOV-readiness core

### 4.1 What's already substrate (workflow-agnostic)

These files have no knowledge of team-sheet fields or any specific workflow. They will be reused by BOV without modification.

| File | What it does | Why it's substrate |
|---|---|---|
| [`render-service/server.js`](render-service/server.js) | Express app boot + route wiring | Adding `/bov/*` routes is a single `app.use(bovRouter)` line |
| [`render-service/config.js`](render-service/config.js) | Env loading + frozen config | Pure infrastructure |
| [`render-service/lib/bridge-client.js`](render-service/lib/bridge-client.js) | `bridgeStatus()` + `bridgeExecute()` | Workflow-agnostic |
| [`render-service/lib/supabase.js`](render-service/lib/supabase.js) | Server-only Supabase client | Workflow-agnostic |
| [`render-service/lib/manifest.js`](render-service/lib/manifest.js) | Walks `<manifest>/<workflow>/<template>/manifest.json`; already path-derives `workflow` per entry | Workflow-aware in the *good* way — loads both `team-sheets/*` and `bov/*` already ([`render-service/lib/manifest.js:25`](render-service/lib/manifest.js#L25)) |
| [`render-service/lib/images.ts`](render-service/lib/images.js) (`images.js`) | URL → bytes with 5-min in-memory cache | Workflow-agnostic |
| [`render-service/lib/render-script.mjs`](render-service/lib/render-script.mjs) | The JS string sent to the bridge. **Field-agnostic** — dispatches on each tile field's declared `type` (`text` vs `image`) and per-tile `key`/`value` arrays | Already designed for arbitrary field sets. BOV's frame names just flow through |
| [`render-service/lib/template-introspect.js`](render-service/lib/template-introspect.js) | Probes a template for `tile_N_address` count to derive `tile_count` | Tile-naming convention is workflow-agnostic if BOV adopts the same `tile_N_*` pattern (which the BOV rename pass is doing for Section 1) |
| [`render-service/lib/auth.js`](render-service/lib/auth.js) | `SERVICE_TOKEN` bearer middleware | Workflow-agnostic |
| [`render-service/routes/status.js`](render-service/routes/status.js) | Bridge health passthrough | Workflow-agnostic |
| [`render-service/lib/comps.js`](render-service/lib/comps.js) | `getCompsByIds()`, `getComps()` against Supabase `comps` table | Likely shared by BOV (BOV's sold-comps cards will also read from `comps`), modulo column-projection adjustments |

### 4.2 What's team-sheet-specific today

These files encode the team-sheet contract: ordered `comp_ids[]` mapping to numbered tiles, the six fixed tile fields, the price/status formatters, the merge-overrides whitelist.

| File | Team-sheet specificity |
|---|---|
| [`render-service/lib/tile-builder.js`](render-service/lib/tile-builder.js) | The `resolveTileFieldValue` switch hardcodes `address | city_state | sf_ac | price | status | photo` and dispatches to the team-sheet formatters in `format.js`. File-level comment already calls this out as "a future refactor" ([line 12](render-service/lib/tile-builder.js#L12)) |
| [`render-service/lib/format.js`](render-service/lib/format.js) | `formatSfAc`, `formatPriceLine` (`price_line_v1`), `formatStatusBadge` (`status_badge_v1`) — all team-sheet conventions |
| [`render-service/lib/merge-overrides.js`](render-service/lib/merge-overrides.js) | `TILE_OVERRIDE_FIELDS` whitelist is the team-sheet field set |
| [`render-service/lib/validate.js`](render-service/lib/validate.js) | Validates `{ template_id, comp_ids[], page_overrides?, tile_overrides? }` — the team-sheet request shape |
| [`render-service/lib/render-pipeline.js`](render-service/lib/render-pipeline.js) | Mostly substrate-shaped, but the contract it serves (comp_ids → ordered tiles, override merge, image staging per-comp) is the team-sheet contract. The orchestration steps generalize; the *shape* of the inputs and outputs doesn't |
| [`render-service/routes/render.js`](render-service/routes/render.js) | Calls `validateRenderRequest` and the team-sheet pipeline |
| [`render-service/routes/introspect.js`](render-service/routes/introspect.js) | Returns `tileCount` / `gridCols` / `tileFieldNames` — useful for picker UIs of *both* workflows but currently consumed only by team-sheet flows |
| [`render-service/routes/page-fields.js`](render-service/routes/page-fields.js) | Manifest-driven, so generalizes to BOV; but today only team-sheet templates have `page_fields` declared |
| [`render-service/routes/preview.js`](render-service/routes/preview.js) | Workflow-agnostic by construction (renders the .indd as-is). Both workflows can reuse |

### 4.3 What BOV needs (by analogy)

The BOV workflow as described in `prompts/bov-naming-plan.md` and the in-progress rename pass differs from team sheets in shape:

- **One heavy template** (`BOV.indd`, 45 spreads) with per-section content rather than a picker of small templates.
- **Multi-section content model**: cover (subject address/aerial/date/brokers), executive summary, pricing recommendations, sold-comps tables + map, Section-1 select-comps grid, Section-3 site/aerial maps, Section-4 marketing/team prose, Section-5 firm/services/clients, brag-sheet tiles (Section-6-ish), submarket maps, broker SOQs.
- **Heavily heterogeneous fields per section**: free-text (exec summary, strengths/opportunities), structured tables (pricing scenarios, sold-comp cards with date/price/$psf/SF/AC), maps (pin shapes + numeric labels), repeated tile grids (brag sheets), broker bios.
- **Per-render variants**: Hannah selects from variant spreads (industrial vs heavy-industrial, submarket choices) and provides per-BOV one-off content (subject address, pricing).
- **Single PDF output** — like team sheets, the artifact is one PDF; the orchestration of "render N spreads from selected variants" is BOV-specific.

What BOV will reuse from substrate, by file:
- `bridge-client.js`, `supabase.js`, `manifest.js`, `images.js`, `render-script.mjs`, `template-introspect.js`, `auth.js`, `comps.js`, `config.js`, `server.js`, `routes/status.js`, `routes/preview.js`.

What BOV will need new (or per-workflow forks of):
- A BOV-specific request validator (the shape isn't `comp_ids[]` — likely `{ section_overrides, variant_selections, comp_ids_by_section, ... }`).
- A BOV-specific orchestration pipeline (variant resolution, multi-section field resolution, broader image staging — subject aerial, optional map renders, broker headshots, sold-comp images).
- A BOV-specific field resolver (the team-sheet `resolveTileFieldValue` switch doesn't generalize to `cover_subject_address`, `exec_strengths_opportunities`, `pricing_main_table`, `s2card_N_details`, etc.).
- BOV-specific formatters (currency styles, lease vs sale formatting for sold-comp cards, the pricing table layout).
- A BOV render route.

### 4.4 Recommended repo structure (recommend; do not move)

```
indesign-uxp-server/
├── bridge/                      (unchanged)
├── plugin/                      (unchanged)
├── render-service/
│   ├── server.js                wires status + teamsheet + bov routers
│   ├── config.js                shared
│   ├── core/                    ← shared substrate (NEW directory; relocations from lib/)
│   │   ├── bridge-client.js     ← from lib/bridge-client.js
│   │   ├── supabase.js          ← from lib/supabase.js
│   │   ├── manifest.js          ← from lib/manifest.js
│   │   ├── images.js            ← from lib/images.js
│   │   ├── render-script.mjs    ← from lib/render-script.mjs
│   │   ├── template-introspect.js ← from lib/template-introspect.js
│   │   ├── auth.js              ← from lib/auth.js
│   │   └── comps.js             ← from lib/comps.js  (shared if BOV also reads `comps`)
│   ├── teamsheet/               ← team-sheet-specific (NEW; relocations from lib/+routes/)
│   │   ├── tile-builder.js      ← from lib/tile-builder.js
│   │   ├── format.js            ← from lib/format.js
│   │   ├── merge-overrides.js   ← from lib/merge-overrides.js
│   │   ├── validate.js          ← from lib/validate.js
│   │   ├── render-pipeline.js   ← from lib/render-pipeline.js (renamed: teamsheet-pipeline.js)
│   │   └── routes/
│   │       ├── render.js        ← from routes/render.js (still served at flat /render — see §5)
│   │       ├── introspect.js    ← from routes/introspect.js
│   │       └── page-fields.js   ← from routes/page-fields.js
│   ├── bov/                     ← BOV-specific (NEW, EMPTY-ish until BOV starts)
│   │   ├── README.md            stub: "BOV-specific render code lands here"
│   │   ├── format.js            (future)
│   │   ├── validate.js          (future)
│   │   ├── section-resolver.js  (future — BOV's equivalent of tile-builder)
│   │   ├── render-pipeline.js   (future)
│   │   └── routes/
│   │       └── render.js        (future — wired at /bov/render)
│   └── routes/
│       ├── status.js            ← unchanged (workflow-agnostic, kept at flat /status)
│       └── preview.js           ← from routes/preview.js (workflow-agnostic, kept at flat /preview)
├── templates/                   .indd files (BOV.indd, team-sheet .indd) — see §6 on gitignore
├── template-manifests/          ← MOVED from dashboard/templates/  (recommended)
│   ├── team-sheets/
│   │   ├── 6_Tile_Defaults/manifest.json
│   │   └── 18_Tile_Price_Status/manifest.json
│   └── bov/                     (empty for now)
└── (dashboard/ deleted after the manifest move)
```

**Why this shape:**

1. The `core/ + teamsheet/ + bov/` split makes the seam *physical*. A `grep -r teamsheet/ bov/` returns nothing — the workflows cannot accidentally entangle.
2. Each workflow has its own `routes/`, `validate.js`, `*-pipeline.js`, and field resolvers. The substrate has no workflow knowledge.
3. `core/` exports stable functions that workflow code imports; workflow code never re-exports back into `core/`.
4. Moving the manifest folder out of `dashboard/` (to `template-manifests/`) breaks the last soft tie to the dashboard. `TEMPLATE_MANIFEST_DIR` defaults to the new path; the dashboard can then be deleted.

### 4.5 File-by-file mapping (recommend; do not move)

| Current path | Proposed path | Why |
|---|---|---|
| `render-service/lib/bridge-client.js` | `render-service/core/bridge-client.js` | Substrate |
| `render-service/lib/supabase.js` | `render-service/core/supabase.js` | Substrate |
| `render-service/lib/manifest.js` | `render-service/core/manifest.js` | Substrate |
| `render-service/lib/images.js` | `render-service/core/images.js` | Substrate |
| `render-service/lib/render-script.mjs` | `render-service/core/render-script.mjs` | Substrate; already field-agnostic |
| `render-service/lib/template-introspect.js` | `render-service/core/template-introspect.js` | Substrate |
| `render-service/lib/auth.js` | `render-service/core/auth.js` | Substrate |
| `render-service/lib/comps.js` | `render-service/core/comps.js` | Substrate (assuming BOV reads same `comps` table) |
| `render-service/lib/tile-builder.js` | `render-service/teamsheet/tile-builder.js` | Team-sheet-specific (resolver switch is team-sheet field set) |
| `render-service/lib/format.js` | `render-service/teamsheet/format.js` | Team-sheet formatters |
| `render-service/lib/merge-overrides.js` | `render-service/teamsheet/merge-overrides.js` | Team-sheet override whitelist |
| `render-service/lib/validate.js` | `render-service/teamsheet/validate.js` | Team-sheet request shape |
| `render-service/lib/render-pipeline.js` | `render-service/teamsheet/render-pipeline.js` | Team-sheet orchestration |
| `render-service/routes/render.js` | `render-service/teamsheet/routes/render.js` | Mounted at flat `/render` for back-compat |
| `render-service/routes/introspect.js` | `render-service/teamsheet/routes/introspect.js` | Mounted at flat `/introspect` for back-compat |
| `render-service/routes/page-fields.js` | `render-service/teamsheet/routes/page-fields.js` | Mounted at flat `/page-fields` for back-compat |
| `render-service/routes/status.js` | `render-service/routes/status.js` (stay) | Workflow-agnostic |
| `render-service/routes/preview.js` | `render-service/routes/preview.js` (stay) | Workflow-agnostic |
| `dashboard/templates/team-sheets/*` | `template-manifests/team-sheets/*` | Decouple from `dashboard/` |
| `dashboard/templates/bov/*` | `template-manifests/bov/*` | Same |

---

## 5. API shape for two workflows (§D)

### 5.1 The compatibility constraint

master-app already calls the team-sheet contract live:
- `GET /status`
- `POST /introspect`
- `GET /page-fields?template_id=...`
- `GET /preview?template_id=...`
- `POST /render` with `{ template_id, comp_ids[], page_overrides?, tile_overrides? }`

Per the analysis-prompt: **the team-sheet contract must keep working without a master-app change.**

### 5.2 Recommended routing

**Asymmetric: team sheets stay flat, BOV is namespaced.**

| Method | Path | Workflow | Notes |
|---|---|---|---|
| GET | `/status` | shared | Bridge health; no change |
| GET | `/preview?template_id=...` | shared | Renders any template as-is; no change |
| POST | `/introspect` | team-sheet (flat) | No change |
| GET | `/page-fields?template_id=...` | team-sheet (flat) | No change |
| POST | `/render` | team-sheet (flat) | No change — frozen contract |
| POST | `/bov/render` | BOV | New |
| POST | `/bov/introspect` | BOV | New (if BOV needs a different introspection payload, e.g. variant list) |
| GET | `/bov/sections?template_id=...` | BOV | New (BOV's analog of page-fields, likely richer) |

**Why asymmetric over symmetric (`/teamsheet/render` + `/bov/render`):**

- Symmetric requires master-app to migrate from `/render` to `/teamsheet/render` even if both are aliased server-side. Asymmetric does not.
- The flat paths are already the de-facto "default workflow = team sheet" choice. Calling that out by keeping them flat encodes the project history without coupling future workflows to it (each future workflow gets its own namespace).
- If symmetric is ever desired, add `/teamsheet/*` as aliases later — additive, no break.

**Implementation hint (recommend, not implementing):** in `render-service/server.js`, wire `app.use("/", teamsheetRouter)` (current shape) and `app.use("/bov", bovRouter)` once `bov/` exists. The two routers do not share middleware beyond `express.json()` and `authMiddleware`, both already global.

### 5.3 Backward-compat acceptance test

Before merging the restructure: re-run `render-service/README.md`'s curl test plan §1–§12 against the restructured service. Each step must produce identical responses (status codes, JSON shapes, `X-Render-*` headers, PDF visual content) to today. The `/render` byte-equality check in §12 is the strictest one.

---

## 6. Deployment & update readiness (§E)

### 6.1 What must be present for a clean `git clone && start` to work

| Item | Source | Currently in repo? | Action |
|---|---|---|---|
| Bridge code | `bridge/server.js` + `bridge/package.json` | yes | none |
| Plugin code | `plugin/*` | yes | none |
| Render service code | `render-service/server.js` + `lib/` + `routes/` + `package.json` | yes | none |
| Render service env | `render-service/.env` | **no, gitignored** (and currently contains live Supabase values in the working tree) | Operator copies `.env.example` → `.env` and fills in `SUPABASE_*` and `SERVICE_TOKEN` |
| Bridge `node_modules` | — | no | `cd bridge && npm install` |
| Render service `node_modules` | — | no | `cd render-service && npm install` |
| Template `.indd` files | `templates/*.indd` | **no, gitignored** (root `.gitignore` excludes `*.indd`) | **Out-of-band delivery required.** See §6.3 |
| Template manifests | `dashboard/templates/<workflow>/<template>/manifest.json` | **yes, but lives under `dashboard/`** | After §4.4 move, lives at `template-manifests/<workflow>/<template>/manifest.json` |
| Mock data | `mock-data/comps.json` + `mock-data/images/` | partial (yes for `comps.json` + `images/`, per `.gitignore` rules) | Not required for production rendering (Supabase is source of truth) |

### 6.2 What should be `.gitignore`d (mostly already is) vs in-repo

Already gitignored, correctly:
- `node_modules/` (root, `bridge/`, `render-service/`, `dashboard/`)
- `.env`, `.env.local`
- `output/` (per-render artifacts)
- IDE / OS junk
- `dashboard/.next/`

**`.gitignore` issues to fix:**

1. **`*.indd` and `*.indt` are gitignored at the repo root** ([`.gitignore:73-79`](.gitignore#L73-L79) and again at lines 106-108). Result: `templates/6_Tile_Defaults.indd`, `templates/18_Tile_Price_Status.indd`, `templates/BOV.indd` are **untracked** (`git ls-files templates/` returns empty). A fresh clone has no templates. Pick one of:
   - **Recommended:** untrack `templates/*.indd` and `templates/*.idlk` exceptions only — i.e., let production templates be versioned, keep the working/scratch `.indd` files ignored. Add an explicit `!templates/*.indd` allowlist below the blanket rule. Pro: clones-and-starts. Con: increases repo size; .indd files are binary and ~300 MB each in this set, which is a real cost.
   - **Alternative:** keep the gitignore, and add a documented out-of-band step (operator copies `.indd` files from a secure share to `templates/` before first start). Pro: keeps the repo small. Con: deploy steps grow; pull+restart is unsafe if templates change at the same time as code.
   - **Hybrid:** version a small reference template ("hello world" `.indd`), keep the heavy production ones out-of-band. Pro: most repo-friendly. Con: production deploys still need the out-of-band copy.
2. `*.idlk` (InDesign lock files) gitignored — correct, those are transient.
3. `mock-data/build-comps.cjs` is gitignored as "build helper script". If it's still needed to regenerate `mock-data/comps.json`, it should be tracked. If it's dead, delete it.
4. `templates/working/` should be added to `.gitignore` so the BOV rename-pass artifacts don't get accidentally committed.

### 6.3 Pull + restart safety

| Concern | Today | Recommendation |
|---|---|---|
| Build step required? | **No** — both bridge and render-service are plain ESM Node. `npm install` if `package.json` changed, otherwise just restart | Document as the official deploy step: `git pull && (cd bridge && npm install --production) && (cd render-service && npm install --production) && systemctl restart ...` |
| Local config that must persist across pull? | `render-service/.env` (gitignored; survives) | Document. If `.env.example` adds a required var, the pull-restart will fail on boot (loud — good) |
| Templates change at the same time as code? | Risk: yes, because templates are not in git. A `git pull` won't update them; a `cp` from the operator's source might race | After §6.2 fix, templates are either versioned (atomic with the pull) or out-of-band with a documented sync command. Either is safe; the current state is not |
| Long-running render in flight during restart? | The render service is single-process. A restart kills any in-flight render | Acceptable for a manual operator-driven deploy; add a `/drain` endpoint later if BOV renders are long-running |
| Templates referenced by absolute path? | No — `INDESIGN_REPO_ROOT` defaults to `path.resolve(__dirname, "..")` ([`render-service/config.js:41`](render-service/config.js#L41)), making the repo location movable | Keep |
| Bridge port hardcoded? | `BRIDGE_URL` is configurable (default `127.0.0.1:3000`); the bridge itself hardcodes `WS_PORT = 3001` and `HTTP_PORT = 3000` ([`bridge/server.js:5-6`](bridge/server.js#L5-L6)) | Acceptable for loopback-only. Make the bridge ports env-configurable if a future Mac runs more than one InDesign instance |
| InDesign / plugin update requires action? | Yes — UXP Developer Tool is the load mechanism, which is manual on the Mac | Document as "after deploy, verify the plugin panel shows `connected: true` via `curl http://127.0.0.1:8765/status`" |
| Secrets in env? | Yes (Supabase anon key, optional `SERVICE_TOKEN`, optional `BRIDGE_TOKEN`) | `.env` is gitignored. **Confirmed: the live `render-service/.env` in this working tree contains a real `SUPABASE_ANON_KEY`**. Operator should rotate before any wider sharing of the working tree. The anon key is read-only-scoped (per Phase 1 setup) so the blast radius is low, but rotation hygiene matters |

### 6.4 The "no dashboard in production" confirmation

Production needs: `bridge/` + `plugin/` + `render-service/` + templates + manifests + `.env`. **The dashboard is not on this list.** The Mac deploy can omit `dashboard/` entirely once §3.3's `TEMPLATE_MANIFEST_DIR` re-pointing lands.

In the interim (today's state), if the Mac clones the whole repo and starts only the bridge + render-service, the dashboard's files are present but unloaded, the dashboard's `node_modules` is unneeded, and nothing in production references the dashboard's TS/TSX files. Wasted disk space; no runtime impact.

---

## 7. Risks & open items

| Item | Risk | Disposition |
|---|---|---|
| `.indd` files gitignored at the repo root | **High** — fresh clone cannot render. Pull-restart unsafe if templates change with code | **Fix before BOV.** Recommended: allowlist `templates/*.indd`; accept the repo size hit, or document an out-of-band sync step |
| Manifests live under `dashboard/templates/` | **Medium** — blocks retiring the dashboard | **Fix before BOV.** Move to `template-manifests/`; update `TEMPLATE_MANIFEST_DIR` default |
| Root `package.json` describes a different project (`indesign-mcp-server` v2) | **Low** — currently misleading documentation but not load-bearing on production | Fix when `src/` is deleted (rewrite or delete `package.json` together) |
| `src/` + `tests/` still on disk | **Low** — disk only; not imported by any production process | Delete in a scoped cleanup task (`analysis/safety-report.md` already pre-recommended this under its "Option C") |
| The team-sheet `tile-builder.js` switch is hardcoded | **Low** for team sheets (already shipped) | The team-sheet section's documented "future refactor" can be deferred until a new team-sheet field is introduced. Not load-bearing for BOV — BOV has its own resolver |
| `merge-overrides.js` whitelist is the team-sheet field set | **Low** — only matters if BOV tries to share the same `/render` endpoint, which §5.2 already rules out | Keep team-sheet-scoped under `teamsheet/` |
| Live `SUPABASE_ANON_KEY` in working-tree `.env` | **Low** — read-only scope, gitignored | Rotate hygiene; not a blocker |
| Bridge ports hardcoded | **Low** — single-InDesign assumption is fine today | Defer |
| `mock-data/build-comps.cjs` gitignored | **Undetermined** — couldn't tell from inspection whether it's still useful | Inspect; either delete or un-gitignore |
| `.planning/` directory | **Undetermined** — possibly stale per prior analysis | Inspect; if stale, archive |
| Dashboard's `/api/images/[filename]` route | **Low** — dashboard-only; goes when dashboard goes | None |
| BOV rename pass is in progress (`templates/working/bov-rename-*.indd`) | **Operational** — that pass is paused at spread 7 (separate todo) | Resume after this analysis lands |

---

## 8. Ordered next steps

Each step is scoped so it can become its own task. Steps 1–4 should land *before* BOV backend work starts. Steps 5+ are post-BOV-kickoff cleanup that can run in parallel with BOV development.

### Before BOV starts (gate items)

1. **Move template manifests out of `dashboard/`.** Create `template-manifests/`; `git mv` `dashboard/templates/team-sheets/` and `dashboard/templates/bov/` into it. Update `render-service/config.js` to default `TEMPLATE_MANIFEST_DIR` to `<repo>/template-manifests`. Update `render-service/.env.example` doc-string. Confirm `loadManifest()` still walks the new path. Acceptance: `/introspect` for both existing templates returns the same response as before.

2. **Resolve the gitignored-templates issue.** Pick one of §6.2's three options. If "allowlist," add `!templates/*.indd` exception in `.gitignore`, `git add templates/*.indd`, commit, and document that `templates/working/` stays ignored. Acceptance: `git clone` of a fresh checkout has all .indd files needed to run `/render` end-to-end.

3. **Restructure `render-service/lib/` into `core/ + teamsheet/`.** `git mv` per §4.5; update import paths inside each moved file; introduce `render-service/bov/` as a stub directory with only a `README.md` ("BOV-specific render code lands here; do not put team-sheet code here, do not put substrate here"). Routes split: `routes/render.js`, `routes/introspect.js`, `routes/page-fields.js` move to `teamsheet/routes/`; `routes/status.js` and `routes/preview.js` stay at the top of `routes/`. Wire in `server.js`. Acceptance: re-run `render-service/README.md` curl plan §1–§12 against the restructured service; all checks pass.

4. **Decide team-sheet API namespace.** Keep current flat paths (recommended in §5.2). Document in `render-service/README.md` that BOV will be served at `/bov/*`. Acceptance: master-app's calls continue working unmodified.

### After BOV starts (cleanup tasks)

5. **Retire the original MCP server.** Delete `src/`, `index.js` (root redirect), `tests/`, `docs/CHANGELOG.md|LLM_PROMPT.md|MCP_INSTRUCTIONS.md`. Replace root `package.json` with a minimal multi-package descriptor (or delete it; `bridge/` and `render-service/` each have their own). Acceptance: nothing in `bridge/`, `plugin/`, or `render-service/` breaks; root no longer claims to be `indesign-mcp-server` v2.

6. **Retire the Next.js dashboard.** After step 1 (manifests moved) and after the user confirms master-app provides the same test affordances they used the dashboard for. Delete `dashboard/`. Acceptance: render service still runs; `master-app` still works.

7. **Archive historical reports.** Create `docs/history/`; move `STAGE-*-NOTES.md`, `phase*-report.md`, `phase-*.md`, `repo_analysis*.md`, `repo-analysis-report.md`, `changes.2026-03-06.md`, `stage-2-report.md` into it. Acceptance: repo root listing reads like a current-state inventory, not a history book.

8. **Rewrite root `README.md`.** Replace the original MCP-server tool catalog with a one-page architecture overview: bridge + plugin + render-service, the two workflows, the deploy steps, the env vars. Acceptance: a new operator can stand the system up from `README.md` alone.

9. **Gitignore polish.** Add `templates/working/`. Decide on `mock-data/build-comps.cjs` (track or delete). Audit `.planning/`. Acceptance: `git status` on a freshly-cloned + run + rendered repo shows no surprises.

10. **Optional: env-configure bridge ports.** Move `WS_PORT` and `HTTP_PORT` to env vars in `bridge/server.js`. Update `BRIDGE_URL` doc to remind operators to keep the bridge HTTP port in sync. Acceptance: bridge can run on alternate ports for multi-instance Mac scenarios.

---

## End-of-document summary

```
Production backend file count:
  bridge/         3 files (server.js, package.json, package-lock.json) + node_modules
  plugin/         4 files (manifest.json, index.html, index.js, README.md)
  render-service/ 20 source files (server.js, config.js, .env.example, 13 lib/, 5 routes/) + node_modules

Does the production backend import from `dashboard/`?  NO.
  Only soft tie: `TEMPLATE_MANIFEST_DIR` env defaults to `<repo>/dashboard/templates`.
  This is fixable with a one-line config change (or by moving the manifests).
  All other `dashboard` references in render-service are comments or operator instructions.

Proposed top-level structure for team-sheet / BOV separation:
  render-service/
    core/         shared substrate (bridge-client, supabase, manifest, images,
                  render-script.mjs, template-introspect, auth, comps, config)
    teamsheet/    team-sheet-specific (tile-builder, format, validate,
                  merge-overrides, render-pipeline, routes/)
    bov/          BOV-specific (stub today; populated when BOV starts)
    routes/       workflow-agnostic (status, preview)

Top BOV-gate fixes (before BOV starts):
  1. Move template manifests out of `dashboard/` to `template-manifests/`.
  2. Resolve the `*.indd` gitignore issue (or document out-of-band delivery).
  3. Restructure render-service/ into core/teamsheet/bov/.
  4. Keep team-sheet API paths flat; add `/bov/*` for BOV (master-app compat).
```
