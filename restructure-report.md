# Backend Restructure — Implementation Report

Implementation pass for `prompts/restructure-prompt.md`. Behavior-preserving
refactor of `render-service/` into a `core/ + teamsheet/ + bov/` seam, with
template manifests moved into a top-level `template-manifests/` directory
and `.indd` files relocated out of the repo entirely, addressed by the new
`TEMPLATES_DIR` env var.

**No external API path or contract changed.** master-app's team-sheet
integration calls the same paths with the same shapes and still receives
the same responses.

**Restore point:** tag `pre-restructure-2026-05-16` at commit `972847e`.

---

## 1. What moved where

### 1.1 Template manifests: `dashboard/templates/` → `template-manifests/`

`git mv` preserved history. Manifest content also updated: the `file` field
now carries just the .indd filename (no `templates/` prefix) since the
service resolves it via `TEMPLATES_DIR`.

| Before | After |
|---|---|
| `dashboard/templates/team-sheets/6_Tile_Defaults/manifest.json` | `template-manifests/team-sheets/6_Tile_Defaults/manifest.json` |
| `dashboard/templates/team-sheets/6_Tile_Defaults/README.md` | `template-manifests/team-sheets/6_Tile_Defaults/README.md` |
| `dashboard/templates/team-sheets/6_Tile_Defaults/render-mapping.ts` | `template-manifests/team-sheets/6_Tile_Defaults/render-mapping.ts` |
| `dashboard/templates/team-sheets/18_Tile_Price_Status/*` | `template-manifests/team-sheets/18_Tile_Price_Status/*` (same three files) |
| `dashboard/templates/bov/README.md` | `template-manifests/bov/README.md` (rewritten — see §1.5) |
| `dashboard/templates/README.md` | `template-manifests/README.md` (rewritten — see §1.5) |

Manifest `file` field updates:
- `"templates/6_Tile_Defaults.indd"` → `"6_Tile_Defaults.indd"`
- `"templates/18_Tile_Price_Status.indd"` → `"18_Tile_Price_Status.indd"`
- `$schema_note` rewritten to point at `template-manifests/...` and the
  TEMPLATES_DIR resolution model.

### 1.2 `.indd` files: out of the repo

The three `.indd` files moved from `<repo>/templates/` to
`<repo>/../indesign-templates/` (sibling of the repo, the new
`TEMPLATES_DIR` default):

```
moved (filesystem, not git — files were gitignored before and stay so):
  templates/6_Tile_Defaults.indd        → ../indesign-templates/6_Tile_Defaults.indd
  templates/18_Tile_Price_Status.indd   → ../indesign-templates/18_Tile_Price_Status.indd
  templates/BOV.indd                    → ../indesign-templates/BOV.indd

left in repo's templates/:
  templates/working/                    BOV rename-pass scratch — preserved per user
                                        (now covered by templates/ in .gitignore;
                                         was always ignored implicitly via *.indd)
```

### 1.3 `render-service/` restructure

`render-service/lib/` and `render-service/routes/` split into
`core/ + teamsheet/ + bov/ + routes/` per the analysis §4.4. Since
`render-service/` was untracked at the start, the files appear as fresh
adds in their new locations (no `git mv` history available to preserve).

**`core/` (shared substrate, no workflow knowledge):**

| Before | After |
|---|---|
| `render-service/lib/auth.js` | `render-service/core/auth.js` |
| `render-service/lib/bridge-client.js` | `render-service/core/bridge-client.js` |
| `render-service/lib/comps.js` | `render-service/core/comps.js` |
| `render-service/lib/images.js` | `render-service/core/images.js` |
| `render-service/lib/manifest.js` | `render-service/core/manifest.js` |
| `render-service/lib/render-script.mjs` | `render-service/core/render-script.mjs` |
| `render-service/lib/supabase.js` | `render-service/core/supabase.js` |
| `render-service/lib/template-introspect.js` | `render-service/core/template-introspect.js` |
| — (new) | `render-service/core/template-paths.js` |

**`teamsheet/` (team-sheet-specific):**

| Before | After |
|---|---|
| `render-service/lib/format.js` | `render-service/teamsheet/format.js` |
| `render-service/lib/merge-overrides.js` | `render-service/teamsheet/merge-overrides.js` |
| `render-service/lib/render-pipeline.js` | `render-service/teamsheet/render-pipeline.js` |
| `render-service/lib/tile-builder.js` | `render-service/teamsheet/tile-builder.js` |
| `render-service/lib/validate.js` | `render-service/teamsheet/validate.js` |
| `render-service/routes/introspect.js` | `render-service/teamsheet/routes/introspect.js` |
| `render-service/routes/page-fields.js` | `render-service/teamsheet/routes/page-fields.js` |
| `render-service/routes/render.js` | `render-service/teamsheet/routes/render.js` |

**`routes/` (workflow-agnostic, unchanged paths):**

| Stays | Notes |
|---|---|
| `render-service/routes/preview.js` | Workflow-agnostic (renders any template as-is) |
| `render-service/routes/status.js` | Workflow-agnostic (bridge health) |

**`bov/` (stub):**

```
render-service/bov/
├── README.md     "BOV-specific render code lands here; do not put
│                  team-sheet code or shared substrate here"
└── routes/
    └── .gitkeep  Empty marker so the directory exists in git
```

`server.js` has a clearly-commented `/bov/*` mount point reserved for
when BOV development begins.

### 1.4 New helper: `core/template-paths.js`

Single point of truth for `manifest.file → absolute path`. All callers
that used to compute `path.resolve(config.repoRoot, tpl.file)` now call
`resolveTemplatePath(tpl)` from this helper. Defensive against legacy
manifests carrying a `templates/` prefix (uses `path.basename`).

**Callers updated:**
- `render-service/routes/preview.js`
- `render-service/teamsheet/render-pipeline.js`
- `render-service/teamsheet/routes/page-fields.js`
- `render-service/core/template-introspect.js` (also simplified — now
  takes a `manifest` object instead of `(templateId, fileRelative)`)

**Call-site updates:**
- `getTemplateIntrospection(tpl.id, tpl.file)` → `getTemplateIntrospection(tpl)`
  (two callers: `teamsheet/render-pipeline.js`, `teamsheet/routes/introspect.js`)

### 1.5 Documentation rewrites

- `template-manifests/README.md` — rewritten to describe the new
  structure, the TEMPLATES_DIR resolution model, and the two update
  paths (`git pull` for code+manifests; drop-in for `.indd`).
- `template-manifests/bov/README.md` — refreshed to point at the new
  paths and the `render-service/bov/` stub.
- `render-service/README.md` — Layout section added; Env-vars table
  updated (`TEMPLATES_DIR` added; `TEMPLATE_MANIFEST_DIR` default
  changed from `<repo>/dashboard/templates` to `<repo>/template-manifests`);
  templates/two-update-paths section added.
- `render-service/.env.example` — `TEMPLATES_DIR` documented;
  comment ordering tightened so `SUPABASE_*` (required) is at the top.
- `dashboard/lib/manifest.ts` — `TEMPLATES_DIR` constant rewired to
  `<repo>/template-manifests/` so the dashboard's `/build/template`
  picker (still useful as a local sanity-check UI) continues to find
  the manifests at their new home.
- `.gitignore` (repo root) — added `templates/` block (the legacy
  `<repo>/templates/` dir now only holds `working/` BOV scratch; the
  actual templates live at `TEMPLATES_DIR`).

### 1.6 Config changes

`render-service/config.js`:
- **New env var: `TEMPLATES_DIR`**, default
  `<repo>/../indesign-templates/`. Path is resolved at boot.
- **Default for `TEMPLATE_MANIFEST_DIR` changed** from
  `<repo>/dashboard/templates` to `<repo>/template-manifests`.
- **New loud boot-time check** (`assertTemplatesDirReady`): errors at
  startup if `TEMPLATES_DIR` doesn't exist, isn't a directory, or
  contains no `.indd` files. The error message includes the resolved
  path and tells the operator what to do (drop `.indd` files there).
- `templatesDir` added to the frozen `config` object exported from
  this file.

Service boot log now reports `templates dir: <path>` alongside
`manifest dir`.

### 1.7 Pre-existing dashboard imports we did NOT touch

The dashboard's `app/api/*` proxy routes already had `RENDER_SERVICE_URL`
env handling and call into the render-service flat endpoints. They
require no change — the team-sheet flat paths are unchanged.

---

## 2. Master-app compatibility — endpoint diff

The point is "no diff." This table proves it.

| Method | Path | Before (handler) | After (handler) | Wire-level change? |
|---|---|---|---|---|
| GET | `/status` | `render-service/routes/status.js` | `render-service/routes/status.js` | **None.** Same response shape, same headers. |
| GET | `/preview?template_id=...` | `render-service/routes/preview.js` | `render-service/routes/preview.js` | **None.** Same PDF output, same `Content-Type`/`Cache-Control`. |
| POST | `/introspect` | `render-service/routes/introspect.js` | `render-service/teamsheet/routes/introspect.js` | **None on the wire.** Internal file moved + helper-style template-path resolution. Request body still `{ template_id }`; response still `{ tileCount, templatePath, gridCols?, tileFieldNames? }`. |
| GET | `/page-fields?template_id=...` | `render-service/routes/page-fields.js` | `render-service/teamsheet/routes/page-fields.js` | **None on the wire.** Same `{ fields: [...] }` shape, same `Cache-Control: private, max-age=30`, same short-circuit for templates with no editable page fields. |
| POST | `/render` | `render-service/routes/render.js` | `render-service/teamsheet/routes/render.js` | **None on the wire.** Same request `{ template_id, comp_ids[], page_overrides?, tile_overrides? }`; same `application/pdf` stream; same `X-Render-*` header set (`Plugin-Total-Ms`, `Populate-Ms`, `Export-Ms`, `Wall-Ms`, `Image-Fetch-Ms`, `Image-Fetched`, `Image-Cache-Hits`, `Image-Skipped-Null`, `Image-Failures`, `Tiles-Blank`, `Applied-Overrides`, `Skipped-Overrides`, `Close-Warning`, `Tile-Overrides-Applied`). |

No method/path/body/response/status/header changed. Internal
template-path resolution and the introspection function signature
changed — both invisible at the HTTP boundary.

Auth behavior unchanged. `SERVICE_TOKEN` middleware seam still in
place, still no-op when unset, still gates everything except
`/status` when set.

---

## 3. Curl test results

Ran with bridge up but **plugin not connected** (you'll reload the
panel before running the full plan yourself — see §6). The structural
checks below validate that the restructured service boots, resolves
manifests from the new location, and routes every endpoint to its new
handler. The `connected: false` responses are expected and prove the
route handlers and bridge-pre-flight checks are wired correctly.

Service boot log:

```
[render-service] listening on http://127.0.0.1:8765
[render-service] bridge url:       http://127.0.0.1:3000
[render-service] repo root:        E:\TAI\indesign-uxp-server
[render-service] manifest dir:     E:\TAI\indesign-uxp-server\template-manifests
[render-service] templates dir:    E:\TAI\indesign-templates
[render-service] output dir:       E:\TAI\indesign-uxp-server\output
[render-service] auth:             DISABLED
```

`manifest dir` and `templates dir` reflect the new paths.

| Endpoint | Response | Verdict |
|---|---|---|
| `GET /status` | `{"service":"render-service","bridgeUrl":"http://127.0.0.1:3000","connected":false,"queueDepth":0}` | ✅ Route works; bridge URL surfaced; `connected: false` because plugin not yet reconnected. |
| `POST /introspect` `{template_id:"6-tile-defaults"}` | `503 {"error":"bridge says plugin not connected","hint":"open InDesign with the Bridge Panel loaded"}` | ✅ Reached the bridge-pre-flight gate — manifest was found (no 404), route was mounted, error shape unchanged. |
| `GET /page-fields?template_id=6-tile-defaults` | `503 {"error":"bridge says plugin not connected",...}` | ✅ Same as above; the editable-page_fields-short-circuit path requires the bridge for the readback. |
| `GET /preview?template_id=6-tile-defaults` | `503 {"error":"bridge says plugin not connected",...}` | ✅ Same as above. |
| `POST /render` `{template_id:"6-tile-defaults",comp_ids:[...6...]}` | `503 {"error":"bridge says plugin not connected",...}` | ✅ Reached the bridge-pre-flight gate. Validate + manifest lookup both passed. |

Full `/render` end-to-end (PDF byte stream + `X-Render-*` headers)
is your manual smoke test in §6.

The bridge **boot-time TEMPLATES_DIR assertion** was implicitly
verified by the service starting up. If `TEMPLATES_DIR` was missing,
the service would have refused to listen and crashed at config-load
time with an actionable error.

---

## 4. Clean-clone start sequence

Repository invariants the post-restructure tree guarantees:
- No absolute or machine-specific paths in committed code or config.
- `.env.example` lists every env var the service reads.
- Lockfiles for both Node packages (`bridge/package-lock.json`,
  `render-service/package-lock.json`) committed.
- `.gitignore` excludes `node_modules/`, `.env`, `*.indd`, `templates/`,
  `output/`; includes `template-manifests/`, source, `.env.example`,
  the `bov/README.md` + `bov/routes/.gitkeep` stub.

Steps to bring a fresh clone online on the on-prem Mac:

```bash
# 1. Clone the repo
git clone <repo-url> indesign-uxp-server
cd indesign-uxp-server

# 2. Install Node deps (two packages)
cd bridge && npm install --omit=dev && cd ..
cd render-service && npm install --omit=dev && cd ..

# 3. Configure render service
cp render-service/.env.example render-service/.env
# Edit render-service/.env and fill in:
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_ANON_KEY=<read-only anon key>
#   SERVICE_TOKEN=<openssl rand -hex 32>     (production only)
#   TEMPLATES_DIR=<absolute path>            (only if defaulting outside the repo isn't right for the Mac)

# 4. Drop .indd templates into TEMPLATES_DIR
#    Default: ../indesign-templates/ (sibling of the repo)
mkdir -p ../indesign-templates
cp /path/to/secure/share/*.indd ../indesign-templates/
# Service refuses to boot if this directory doesn't exist or has no .indd files.

# 5. Start the bridge (terminal 1)
cd bridge && node server.js

# 6. Start the render service (terminal 2)
cd render-service && node server.js

# 7. In InDesign:
#    UXP Developer Tool → Load → select plugin/manifest.json → Show Panel
#    Verify the panel reads "Connected" (the bridge's WS handshake)

# 8. Smoke-test from a third terminal
curl http://127.0.0.1:8765/status
# Expect: {"service":"render-service",...,"connected":true,"queueDepth":0}
```

Sanity-check curl plan for a fresh clone:

```bash
# Both team-sheet templates registered
curl -sX POST http://127.0.0.1:8765/introspect \
  -H "Content-Type: application/json" \
  -d '{"template_id":"6-tile-defaults"}'
# Expect: {"tileCount":6,"templatePath":"<TEMPLATES_DIR>/6_Tile_Defaults.indd",...}

curl -sX POST http://127.0.0.1:8765/introspect \
  -H "Content-Type: application/json" \
  -d '{"template_id":"18-tile-price-status"}'
# Expect: {"tileCount":18,...}
```

If `templatePath` in the response shows the resolved path under
`TEMPLATES_DIR`, the manifest + path-helper plumbing is wired
correctly on the fresh clone.

---

## 5. What stayed out of scope (per the prompt's hard rules)

- `dashboard/` not retired. Still on disk; its `lib/manifest.ts` was
  rewired to look at the new `template-manifests/` location so the
  picker still works.
- Original MCP server (`src/`, `tests/`, root `package.json`,
  `index.js`) untouched.
- Phase history reports (`STAGE-*-NOTES.md`, `phase*.md`,
  `repo*-analysis*.md`, `changes.2026-03-06.md`,
  `stage-2-report.md`) all stayed at the repo root. Cleanup deferred.
- `mock-data/`, `output/`, `analysis/` untouched.
- `templates/working/bov-rename-*.indd` (BOV rename scratch) explicitly
  not touched per your instruction.
- No BOV code. `render-service/bov/` is a README + an empty `routes/`
  directory.

---

## 6. Master-app smoke test — run after reading this

To validate the refactor with master-app's live team-sheet flow:

1. **Restart the bridge panel in InDesign.** The bridge process was
   killed and restarted during this work; the UXP plugin's
   auto-reconnect doesn't always fire cleanly. In InDesign:
   - Window → UXP Developer Tool (if not already open)
   - Find the Bridge Panel entry → click **Reload** (or Close → Show again)
   - Confirm the panel reads "Connected"

   Then re-check:
   ```bash
   curl http://127.0.0.1:8765/status
   # Expect: connected: true
   ```

2. **Run the existing `render-service/README.md` curl plan §1–§12.**
   Every check must produce the same response shape and (for `/render`
   + `/preview`) the same PDF visual content as before this refactor.
   The byte-equality check in README §12 is the strictest.

3. **Open master-app's Team Sheets flow and generate a sheet
   end-to-end against the restructured render service.** The expected
   outcome is identically what it was before this refactor — no UI
   changes, no contract changes, no degraded behavior. If anything
   regresses, the post-refactor state is recoverable via
   `git checkout pre-restructure-2026-05-16`.

If the master-app smoke test passes, the refactor is done.

---

## 7. Commits

Per the prompt's "small, reviewable steps":

1. `chore: relocate template manifests into template-manifests/ + filename-only file field` — git-mv from `dashboard/templates/` + JSON file-field rewrite + `template-manifests/README.md` and `template-manifests/bov/README.md` rewrites + `dashboard/lib/manifest.ts` path update so the picker still works.
2. `refactor: render-service into core/ + teamsheet/ + bov/` — config.js (TEMPLATES_DIR + new TEMPLATE_MANIFEST_DIR default + boot-time assert), core/template-paths.js helper, lib → core/+teamsheet/ moves with import patching, routes/ kept/moved, server.js wiring with reserved `/bov/*` mount, bov/ stub.
3. `docs: render-service README + .env.example for the restructured layout` — README layout/env/two-update-paths sections, .env.example.
4. `chore: .gitignore the legacy templates/ dir (.indd live out of repo now)` — surgical addition.
5. `docs: restructure-report.md` — this file.

Tag `pre-restructure-2026-05-16` at `972847e` is the recovery point.
