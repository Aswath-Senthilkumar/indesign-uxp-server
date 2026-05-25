# render-service

Standalone HTTP render service. Owns the bridge connection, the
template manifest registry, Supabase comp reads, image staging, and
PDF generation. Phase 1 of the dashboard/backend separation lifted
these responsibilities out of `dashboard/app/api/*`; the dashboard's
4 affected routes are now thin proxies to this service.

The service is itself a **client** of the bridge (`bridge/server.js`,
HTTP 3000 + WS 3001). The bridge and UXP plugin are unchanged.

```
┌────────────┐   HTTP    ┌──────────────┐   HTTP    ┌────────────┐   WS    ┌─────────────┐
│ master-app │  ───────▶ │ render-svc   │  ───────▶ │  bridge    │  ─────▶ │ UXP plugin  │
│ (or curl)  │ :8765     │ (this repo)  │ :3000     │ (this repo)│ :3001   │ (InDesign)  │
└────────────┘           └──────────────┘           └────────────┘         └─────────────┘
```

---

## Layout

Restructured 2026-05-16 to make the team-sheet / BOV seam physical.

```
render-service/
├── server.js              wires routes; mounts /bov/* later
├── config.js              env-derived frozen config
├── core/                  shared substrate (no workflow knowledge)
│   ├── auth.js
│   ├── bridge-client.js
│   ├── comps.js
│   ├── images.js
│   ├── manifest.js
│   ├── render-script.mjs  field-agnostic bridge JS-string generator
│   ├── supabase.js
│   ├── template-introspect.js
│   └── template-paths.js  resolves manifest.file → ${TEMPLATES_DIR}/file
├── teamsheet/             team-sheet-specific
│   ├── format.js          formatSfAc, formatPriceLine, formatStatusBadge
│   ├── merge-overrides.js
│   ├── render-pipeline.js
│   ├── tile-builder.js    resolveTileFieldValue dispatch
│   ├── validate.js
│   └── routes/
│       ├── introspect.js  POST /introspect
│       ├── page-fields.js GET /page-fields
│       └── render.js      POST /render
├── bov/                   stub. BOV-specific code lands here later
│   └── routes/            mount point reserved in server.js as /bov/*
└── routes/                workflow-agnostic
    ├── status.js          GET /status
    └── preview.js         GET /preview
```

**External API paths are flat and frozen** — master-app's team-sheet
integration relies on `/render`, `/introspect`, `/page-fields`,
`/preview`, `/status` exactly as they are. BOV will attach at
`/bov/*` (mount point reserved in `server.js`).

## Templates: OUT of git, addressed by `TEMPLATES_DIR`

The `.indd` template files are large (~200 MB each) and exceed
GitHub's per-file limit, so they live **outside the repo**:

- **Manifests** (small JSON) → `<repo>/template-manifests/<workflow>/<name>/manifest.json` — committed.
- **`.indd` files** → `${TEMPLATES_DIR}/<filename>.indd` — not committed.

Each manifest references its template by **filename only**:

```json
{ "id": "6-tile-defaults", "file": "6_Tile_Defaults.indd", ... }
```

`TEMPLATES_DIR` defaults to `<repo>/../indesign-templates/` (sibling
of the repo, set in `config.js`). Override via the env var if your
operator drops templates somewhere else. The service performs a
loud boot-time check: if `TEMPLATES_DIR` doesn't exist, isn't a
directory, or contains no `.indd` files, the service refuses to
start with an actionable error pointing at the configured path.

### Two update paths

| Change | What to do |
|---|---|
| Code or manifest change | `git pull` + restart the render service |
| Template `.indd` add or change | Drop / replace the `.indd` in `TEMPLATES_DIR` + restart |

**A new template needs both** — drop the `.indd` into `TEMPLATES_DIR`
*and* commit the matching `manifest.json` under
`template-manifests/<workflow>/<name>/`, then restart. The `.indd`
alone won't register without a manifest; the manifest alone produces
a "template file not found" error at render time naming the expected
`${TEMPLATES_DIR}/<file>` path.

---

## Endpoints

All paths are flat (no `/api/templates/[id]/...`). All paths are
served over HTTP on the configured port (default 8765, loopback only).

| Method | Path           | Body / Query                                                     | Response                          |
|--------|----------------|------------------------------------------------------------------|-----------------------------------|
| GET    | `/status`      | —                                                                | JSON bridge health                |
| POST   | `/introspect`  | `{ template_id }`                                                | JSON `{ tileCount, gridCols?, tileFieldNames?, templatePath }` |
| GET    | `/page-fields` | `?template_id=<id>`                                              | JSON `{ fields: [...] }`          |
| GET    | `/preview`     | `?template_id=<id>`                                              | `application/pdf` inline          |
| POST   | `/render`      | `{ template_id, comp_ids[], page_overrides?, tile_overrides? }`  | `application/pdf` + `X-Render-*` headers |

### `GET /status`

Always 200. Returns the bridge's connected/queueDepth so callers can
pre-flight without knowing the bridge URL.

```jsonc
{
  "service": "render-service",
  "bridgeUrl": "http://127.0.0.1:3000",
  "connected": true,
  "queueDepth": 0
}
```

When the bridge is unreachable, the response is 503 with the same
shape plus `error`/`hint`/`detail`. **Branch on `connected`, not
the HTTP status**, to differentiate "bridge says no" from
"service down".

### `POST /introspect` `{ template_id }`

Returns the template's tile count plus a couple of manifest hints so
the caller can skip a second round-trip. Backed by a process-lifetime
in-memory cache keyed by `template_id` — restart the service to force
a re-probe.

```jsonc
{
  "tileCount": 6,
  "templatePath": "e:\\TAI\\indesign-uxp-server\\templates\\6_Tile_Defaults.indd",
  "gridCols": 2,
  "tileFieldNames": ["address", "city_state", "sf_ac", "photo"]
}
```

Errors: 400 missing body field, 404 unknown id, 503 bridge unreachable
or plugin disconnected, 502 bridge call failed, 500 other.

### `GET /page-fields?template_id=<id>`

Reads the current frame contents for each editable `page_field` in
the template's manifest. Returns metadata so the caller can render
labeled inputs in one round trip. Templates with no editable page
fields short-circuit to `{ fields: [] }` **without** a bridge call.

```jsonc
{
  "fields": [
    { "field": "title",   "frame": "page_title",   "label": "Title",   "current_value": "Recently Leased", "missing": false },
    { "field": "tagline", "frame": "page_tagline", "label": "Tagline", "current_value": "Phoenix, AZ",     "missing": false }
  ]
}
```

`Cache-Control: private, max-age=30`. Errors: 400/404/500/502/503 with
JSON `error`/`hint`/`detail`.

### `GET /preview?template_id=<id>`

Renders the template AS-IS (no tile data populated) and streams the
PDF back inline. Same isolation model as `/render`: opens via
`OpenOptions.openCopy`. Headers: `Content-Type: application/pdf`,
`Content-Disposition: inline; filename="<label>.pdf"`,
`Cache-Control: private, max-age=10`.

### `POST /render` — **the contract Phase 2 builds against**

Request body:

```jsonc
{
  "template_id":    "6-tile-defaults",
  "comp_ids":       ["uuid-a", "uuid-b", "uuid-c", "uuid-d", "uuid-e", "uuid-f"],
  "page_overrides": { "title": "Recently Leased", "tagline": "Phoenix, AZ" },
  "tile_overrides": {
    "uuid-a": {
      "address": "1234 W Custom Address",
      "image_url": "https://.../override.jpg"
    },
    "uuid-c": { "image_url": "https://.../different.jpg" }
  }
}
```

- `comp_ids` is **ordered**: tile N is populated from `comp_ids[N-1]`.
- `comp_ids.length` must equal the template's tile_count.
- `page_overrides` is keyed by manifest `page_fields[].field`; empty
  string values are skipped (templates default applies). Only fields
  marked `editable` in the manifest are forwarded to the bridge.
- `tile_overrides` is **optional**; absent or `{}` means "behave
  exactly as today" — see the dedicated section below for the merge
  semantics and supported fields.

Success: `200 application/pdf` byte stream with the following
response headers:

| Header                          | Meaning                                                                         |
|---------------------------------|---------------------------------------------------------------------------------|
| `Content-Type`                  | `application/pdf`                                                               |
| `Content-Length`                | byte size                                                                       |
| `X-Render-Plugin-Total-Ms`      | total time inside the UXP plugin                                                |
| `X-Render-Populate-Ms`          | populate-phase time (tile field writes + page-override fan-out)                 |
| `X-Render-Export-Ms`            | exportFile time                                                                 |
| `X-Render-Wall-Ms`              | wall-clock time inside the service (includes image staging + bridge round-trip) |
| `X-Render-Image-Fetch-Ms`       | total time spent fetching images                                                |
| `X-Render-Image-Fetched`        | count of image bytes fetched from Supabase                                      |
| `X-Render-Image-Cache-Hits`     | count of images served from the 5-min in-memory cache                           |
| `X-Render-Image-Skipped-Null`   | (when nonzero) count of comps with null `image_url`                             |
| `X-Render-Image-Failures`       | (when nonzero) count of image fetches that errored                              |
| `X-Render-Tiles-Blank`          | (when nonzero) csv of tile indexes rendered as grey placeholder                 |
| `X-Render-Applied-Overrides`    | csv of `frame:count` showing page-override fan-out                              |
| `X-Render-Skipped-Overrides`    | (when nonzero) csv of override frames not found in the .indd                    |
| `X-Render-Close-Warning`        | (when nonzero) first 200 chars of any close-doc error                           |
| `X-Render-Tile-Overrides-Applied` | (when any override applied) csv of `comp_id:applied-field-count`              |

Error codes:

| Status | When                                                                       |
|--------|----------------------------------------------------------------------------|
| 400    | invalid JSON; missing/malformed `template_id` or `comp_ids`; comp_ids length ≠ tile_count; unknown comp ids (response carries `missing: [...]`) |
| 404    | `template_id` not found in the manifest registry                           |
| 502    | bridge call failed (upstream HTTP status preserved when ≥400)              |
| 503    | bridge unreachable at the configured URL; plugin not connected             |
| 500    | template file missing on disk; bridge `ok: false`; PDF missing after render |

#### `tile_overrides` (Phase 3 contract addition)

Sparse map keyed by `comp_id` containing per-comp field overrides for
**one render only**. The Supabase `comps` row is not mutated. Use case:
a broker wants this team sheet to show a different photo or a corrected
address for one comp, without affecting other saved sheets that
reference the same comp.

Merge rule: the override object is shallow-merged on top of the comp
row read from Supabase (override wins per field), then the merged
object flows through the existing formatters and image-fetch path
just as a real comp would. There is no separate "override pipeline" —
the merged object IS the comp from the formatters' point of view.

- **Optional.** Absent or `{}` → behave exactly as today (no merge,
  no header). Per-comp `{}` is valid and contributes nothing.
- **Keyed by `comp_id`.** Override follows the comp on tile reorder.
  If `comp_ids[]` contains the same id more than once, the same
  override applies to every occurrence; the response header reports
  the count once per unique `comp_id`.
- **Sparse.** Only the fields the user touched appear. Missing keys
  fall back to the DB row.
- **`null` is a real override value** (e.g. clearing the price line).
  Only JS `undefined` / absent keys mean "no override".
- **Unknown override keys hard-error.** No silent ignore.

Supported override fields (anything else → 400):

| Field             | Type             | Drives                                |
|-------------------|------------------|---------------------------------------|
| `address`         | `string \| null` | `address` tile_field                  |
| `city`            | `string \| null` | `city_state` formatter (with `state`) |
| `state`           | `string \| null` | `city_state` formatter (with `city`)  |
| `building_sf`     | `number \| null` | `sf_ac` formatter (SF half)           |
| `land_area`       | `number \| null` | `sf_ac` formatter (AC half)           |
| `sale_price`      | `number \| null` | `price` formatter (`price_line_v1`)   |
| `base_rent_total` | `number \| null` | `price` formatter (`price_line_v1`)   |
| `lease_format`    | `string \| null` | `price` formatter (`price_line_v1`)   |
| `status`          | `string \| null` | `status` formatter (`status_badge_v1`); pass the pre-transform value (e.g. `"PENDING"` becomes `"PENDING SALE"`) |
| `image_url`       | `string \| null` | `photo` tile_field; same fetch path + 5-min cache as comp `image_url`. A fresh URL misses cache. `null` → grey placeholder |

Validation errors (400, all routed through the standard
`{error: "validation failed", details: [...]}` shape):

- `tile_overrides`: not an object → `expected object keyed by comp_id`
- `tile_overrides.<comp_id>`: not in `comp_ids[]` → `comp_id not in comp_ids[]`
- `tile_overrides.<comp_id>`: not an object → `expected object`
- `tile_overrides.<comp_id>.<field>`: not in whitelist → `unknown override key`
- `tile_overrides.<comp_id>.<field>`: wrong type → `expected <type> or null, got <actualtype>`

---

## Environment variables

Copy `render-service/.env.example` to `render-service/.env` and fill
the Supabase values. Everything else has sensible defaults for local use.

| Variable                | Default                              | Notes                                                          |
|-------------------------|--------------------------------------|----------------------------------------------------------------|
| `SUPABASE_URL`          | **required**                         | Anon-key-scoped read-only credentials                          |
| `SUPABASE_ANON_KEY`     | **required**                         | Anon key, read-only-scoped                                     |
| `BRIDGE_URL`            | `http://127.0.0.1:3000`              | Bridge HTTP base URL. Single source of truth for the service.  |
| `PORT`                  | `8765`                               | Service listen port (loopback)                                 |
| `INDESIGN_REPO_ROOT`    | parent of `render-service/`          | Anchors `output/` (per-render PDF staging)                     |
| `TEMPLATE_MANIFEST_DIR` | `<repo>/template-manifests`          | Manifest source dir. In-repo. Don't override unless running from a non-default checkout. |
| `TEMPLATES_DIR`         | `<repo>/../indesign-templates`       | Where `.indd` files live. **Out of repo** (sibling). Loud boot error if missing or empty. |
| `SERVICE_TOKEN`         | unset (auth disabled)                | When set, every request except `/status` requires `Authorization: Bearer <SERVICE_TOKEN>`. Off by default for local; set in production. |

---

## Run

Once-only setup:

```powershell
cd render-service
npm install
Copy-Item .env.example .env
# edit .env and paste SUPABASE_URL and SUPABASE_ANON_KEY from
# ..\dashboard\.env.local
```

Start (one terminal per process):

```powershell
# terminal 1 — bridge (unchanged)
cd bridge
npm install
node server.js

# terminal 2 — render-service (this README)
cd render-service
node server.js

# terminal 3 — open InDesign, load the UXP Bridge Panel
#             then verify `/status` shows connected: true
```

`node --watch server.js` (npm run dev) reloads on file change in dev.

---

## Curl test plan

Prereqs: bridge running, InDesign + plugin connected, render-service
running, `.env` filled in.

### 1. Health

```powershell
curl http://127.0.0.1:8765/status
# expect: { "connected": true, "queueDepth": 0, ... }
```

If `connected` is `false`, open InDesign and re-load the Bridge Panel
via UXP Developer Tool. Fix this before continuing.

### 2. Introspect

```powershell
curl -X POST http://127.0.0.1:8765/introspect `
  -H "Content-Type: application/json" `
  -d '{ \"template_id\": \"6-tile-defaults\" }'
# expect: tileCount: 6, gridCols: 2, tileFieldNames: [...]

curl -X POST http://127.0.0.1:8765/introspect `
  -H "Content-Type: application/json" `
  -d '{ \"template_id\": \"18_Tile_Price_Status\" }'
# expect: tileCount: 18
```

### 3. Page-fields

```powershell
curl "http://127.0.0.1:8765/page-fields?template_id=6-tile-defaults"
# expect: { "fields": [{ field: "title", ... }, { field: "tagline", ... }] }
```

If a template has no editable fields, expect `{ "fields": [] }` and
no bridge call (verify by watching the bridge console — no `Sending
execute:` log line).

### 4. Preview

```powershell
curl -o preview.pdf "http://127.0.0.1:8765/preview?template_id=6-tile-defaults"
# open preview.pdf — a valid PDF of the template as authored
```

### 5. Render (the real test)

Pick six real comp ids from Supabase (any six rows where
`internal_deal = true`). Paste them into the array below in the order
you want them on the sheet:

```powershell
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  page_overrides = @{ title = "Recently Leased"; tagline = "Phoenix, AZ" }
} | ConvertTo-Json

curl.exe -X POST http://127.0.0.1:8765/render `
  -H "Content-Type: application/json" `
  -d $body `
  -o render.pdf -D headers.txt
# expect:
#   - 200 OK
#   - render.pdf is a valid 6-tile sheet
#   - headers.txt contains X-Render-Plugin-Total-Ms, X-Render-Applied-Overrides, etc.
```

### 6. Error surfaces

Wrong-length `comp_ids`:

```powershell
$body = @{ template_id = "6-tile-defaults"; comp_ids = @("uuid-1","uuid-2") } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render `
  -H "Content-Type: application/json" `
  -d $body
# expect: 400 { "error": "expected 6 comp_ids (per template tile_count), got 2", ... }
```

Unknown comp id:

```powershell
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","does-not-exist")
} | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render `
  -H "Content-Type: application/json" `
  -d $body
# expect: 400 { "error": "unknown comp_ids: does-not-exist", "missing": [...] }
```

Tile-order swap (render the same comps in two different orders, diff
the PDFs — tile_1 should show whatever id is first):

```powershell
# order A
$body = @{ template_id = "6-tile-defaults"; comp_ids = @("A","B","C","D","E","F") } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o orderA.pdf

# order B (A and B swapped)
$body = @{ template_id = "6-tile-defaults"; comp_ids = @("B","A","C","D","E","F") } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o orderB.pdf
# expect: orderA.pdf shows A in tile_1, B in tile_2; orderB.pdf shows B in tile_1, A in tile_2
```

Bridge stopped (cleanest negative test):

```powershell
# stop the bridge (Ctrl-C in its terminal), then:
curl http://127.0.0.1:8765/status
# expect: 503 with detail referencing the configured BRIDGE_URL
# (NOT a hardcoded "127.0.0.1:3000" — confirm the message uses the
#  configured value)

$body = @{ template_id = "6-tile-defaults"; comp_ids = @("A","B","C","D","E","F") } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body
# expect: 503 with same message shape
```

### 8. Tile overrides — single field

```powershell
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  tile_overrides = @{
    "uuid-1" = @{ address = "1234 W Override Ln" }
  }
} | ConvertTo-Json -Depth 4

curl.exe -X POST http://127.0.0.1:8765/render `
  -H "Content-Type: application/json" `
  -d $body -o tile-override.pdf -D headers.txt
# expect:
#   - 200 OK, valid PDF
#   - X-Render-Tile-Overrides-Applied: uuid-1:1
#   - Tile 1 address line shows "1234 W Override Ln"
#   - Tiles 2-6 unchanged from the no-override render
```

### 9. Tile overrides — image_url

Upload a test image to a public URL (Supabase storage bucket
`team-sheet-tile-overrides` is the eventual destination per the
master-app phase-3 plan; any reachable public URL works for testing).

```powershell
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  tile_overrides = @{
    "uuid-3" = @{ image_url = "https://<test-bucket>/override.jpg" }
  }
} | ConvertTo-Json -Depth 4

curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o img-override.pdf -D headers.txt
# expect:
#   - Tile 3 photo is the override image (not comp.image_url)
#   - X-Render-Image-Fetched count includes the override fetch
#   - X-Render-Tile-Overrides-Applied: uuid-3:1
```

### 10. Tile overrides — multi-field with formatter

```powershell
$body = @{
  template_id = "18-tile-price-status"
  comp_ids = @( <18 ids> )
  tile_overrides = @{
    "<uuid-of-tile-1-comp>" = @{
      sale_price = 5500000
      base_rent_total = $null
      status = "PENDING"
    }
  }
} | ConvertTo-Json -Depth 4

curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o multi-override.pdf -D headers.txt
# expect:
#   - Tile 1 price line shows "$5,500,000" (sale-only formatter)
#   - Tile 1 status badge shows "PENDING SALE" (transformed via status_badge_v1)
#   - X-Render-Tile-Overrides-Applied: <uuid>:3
#   - Other tiles unchanged
```

### 11. Validation errors

```powershell
# Override for a comp_id not in comp_ids[]
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  tile_overrides = @{ "uuid-99" = @{ address = "stranger" } }
} | ConvertTo-Json -Depth 4
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body
# expect: 400 {
#   "error": "validation failed",
#   "details": [{ "field": "tile_overrides.uuid-99", "message": "comp_id not in comp_ids[]" }]
# }

# Unknown override key
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  tile_overrides = @{ "uuid-1" = @{ tenant = "Acme Co" } }
} | ConvertTo-Json -Depth 4
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body
# expect: 400 details containing
#   { "field": "tile_overrides.uuid-1.tenant", "message": "unknown override key" }

# Wrong field type
$body = @{
  template_id = "6-tile-defaults"
  comp_ids = @("uuid-1","uuid-2","uuid-3","uuid-4","uuid-5","uuid-6")
  tile_overrides = @{ "uuid-1" = @{ building_sf = "not a number" } }
} | ConvertTo-Json -Depth 4
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body
# expect: 400 details containing
#   { "field": "tile_overrides.uuid-1.building_sf", "message": "expected number or null, got string" }
```

### 12. Backward compatibility (the most important one)

Re-run sections 1–7 **unmodified** with the new build. Each step must
produce the same status code, same JSON shape, and — for /render and
/preview — the same PDF bytes and same `X-Render-*` header values as
before this phase. **No `X-Render-Tile-Overrides-Applied` header**
should appear on any of those requests.

Quick byte-equality check on PDFs:

```powershell
# Capture a no-override render
$body = @{ template_id = "6-tile-defaults"; comp_ids = @( <6 ids> ) } | ConvertTo-Json
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o no-override.pdf

# Same request, explicit empty tile_overrides
$body = @{ template_id = "6-tile-defaults"; comp_ids = @( <6 ids> ); tile_overrides = @{} } | ConvertTo-Json -Depth 4
curl.exe -X POST http://127.0.0.1:8765/render -H "Content-Type: application/json" -d $body -o empty-override.pdf

# Hash both — should match. InDesign's PDF export embeds a generation
# timestamp, so the comparison is "same visual content" rather than
# strictly identical bytes; use a PDF differ (or simply visual compare)
# rather than sha256 if your PDF exporter writes timestamps.
Get-FileHash no-override.pdf, empty-override.pdf
```

If any prior test regresses, the implementation is wrong — restore to
`pre-phase3-tile-overrides-2026-05-20` and re-investigate.

---

## What changed vs. the old dashboard routes

- New input contract for `/render`: **comp_ids only**, no Comp
  objects. The backend reads comp data from Supabase by id and
  preserves request order as tile order.
- Endpoint paths are flat: `/render`, `/introspect`, `/page-fields`,
  `/preview` instead of `/api/templates/[id]/...`.
- Bridge URL comes from `BRIDGE_URL` env. No hardcoded `127.0.0.1:3000`
  in service logic or error strings.
- Service `/status` is always reachable without auth (callers
  pre-flight without needing the token).
- All other behavior carried over unchanged: image cache (5-min TTL),
  per-render working dir cleanup, openCopy isolation,
  `X-Render-Tiles-Blank` accounting, override fan-out across pages.

The full migration write-up lives in `../phase1-report.md` at the
repo root.
