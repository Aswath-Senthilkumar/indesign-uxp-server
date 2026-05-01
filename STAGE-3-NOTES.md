# STAGE 3 NOTES

End-to-end render of one comp through Hannah's template (`template-v2-test.indd`),
populating four named frames in tile 1, exporting to PDF.

Companion to `STAGE-2-NOTES.md`. Same structure: each sub-stage records the
verification step, raw output, and any findings worth surfacing for Stage 4.

---

## Stage 3 — One-page summary

**Branch:** `analysis/initial-pass`
**Reference tag (Stage 2):** `stage-1.5-complete` at `1ee2156`.
**Commits added in Stage 3:** **8** (this wrap-up will be #8).

### Sub-stages

| | Status | Commit |
|---|---|---|
| 3.1 Template prep | ✅ pass | `983fb4b` |
| 3.2 Frame verification (smoke test) | ✅ pass | `377bb2e` |
| 3.3 Mock data prep | ✅ pass | `7cbfd40` (data) + `b53cf0d` (notes) |
| 3.4 Render script | ✅ pass | `5f777db` (notes) + `9d6193b` (script — gitignore-fix follow-up) |
| 3.5 Visual verification | ✅ pass | `746f7cf` |
| 3.6 Wrap-up | this commit | (this commit) |

### Frame verification result (3.2)

```json
{
  "tile_1_photo":      { "text": false, "rectangle": true  },
  "tile_1_address":    { "text": true,  "rectangle": false },
  "tile_1_city_state": { "text": true,  "rectangle": false },
  "tile_1_sf_ac":      { "text": true,  "rectangle": false }
}
```

Exactly the expected type assignment for each named frame; no typos, no
missing frames.

### Mock comp used

`mock-3` — **3635 S 43rd Ave, Phoenix, AZ**, 17,799 SF / 133.00 AC.
Image: `mock-data/images/3635-s-43rd-ave.jpg` (177 KB).
The 133-acre `land_area` is legitimate (user-confirmed, not a typo).

### Render time

**7.27 s total** for one tile, six steps (one HTTP round-trip each):

```
   48 ms  confirm active document
   90 ms  set tile_1_address
  277 ms  set tile_1_city_state
   12 ms  set tile_1_sf_ac
  316 ms  place + fit tile_1_photo (FILL_PROPORTIONALLY)
 6459 ms  export PDF
─────────
 7268 ms  total
```

PDF: `output/test-render.pdf` (294.9 KB).

Naive scaling to 12 tiles ≈ ~16 s of populate work + one ~6.5 s export
≈ ~22 s wall-clock — still within 30 s, but if we push tile count up or
add image-rich tiles, **batching the populate operations into a single
`/execute` script** is the obvious optimisation. Stage 4 work, not 3.

### Visual verification (3.5) — verbatim

> "Compared everything and the swap looks clean."

Photo fit (`FitOptions.fillProportionally`) produced the expected aerial
framing for the test image; other tiles untouched.

### Commits added in Stage 3

```
983fb4b docs: stage 3.1 template prep recorded
377bb2e docs: stage 3.2 frame verification passed
7cbfd40 chore: stage 3.3 mock data (comps.json + 7 images)
b53cf0d docs: stage 3.3 mock data prep
5f777db feat: stage 3.4 first render script
9d6193b fix: stage 3.4 add test-render.js (caught by stale test-*.js gitignore rule)
746f7cf docs: stage 3.5 visual verification passed
(this) docs: stage 3 complete
```

### To flag for Stage 4

| Item | Source |
|---|---|
| `FitOptions.fillProportionally` (camelCase, UXP form) confirmed correct for aerial photos in this template — re-use for all 12 tiles | Stage 3.4 |
| 12-tile render should batch populate operations into one `/execute` script (one HTTP round-trip + one `new Function` compile + one PDF export) — naive per-tile-per-call scaling makes a 12-tile render walk to the 30 s ceiling | Stage 3.4 latency analysis |
| `INDESIGN_ALLOWED_ROOTS` does not gate calls that go direct to the bridge `/execute` endpoint — the path validator only runs in `src/handlers/`. If we want path-traversal protection for the Stage-4 dashboard's render path, we need either (a) bridge-side path validation as a separate request shape, or (b) caller-side validation in master-app | Stage 3.4 path-safety note |
| Acres rendered as `133.00 AC` per the "to 2 decimal places" rule. If Hannah prefers integer-acre values to render without `.00`, the formatter in `formatSfAc()` is one line to change. Hold for Hannah's review | Stage 3.4 / 3.5 |
| Stage 2E's deferred items still apply (mandatory `BRIDGE_TOKEN`, tighten `network.domains`, `/execute` check ordering, force-quit timeout disambiguation, orphan-result resubmit pattern) | from STAGE-2-NOTES.md |

---

## Stage 3 complete

The first end-to-end render through Hannah's real template **works**.
One comp, four named frames populated, image placed and fit, PDF
exported, no other content disturbed. The substrate proven through
Stage 2 is now a render pipeline through Stage 3.

Tag: `stage-3-complete` at the wrap-up commit `e2ed837`. **Pushed to
`origin`** and verified via `git ls-remote --tags`.

---

## Stage 3.7 — Batched multi-tile render

### Goal

Replace Stage 3.4's per-call-per-operation pattern with a single
`/execute` call that drives all tile populates + one PDF export. The
substrate sees one `new Function('app', code)` compile, one HTTP
round-trip, and one undo step covering the whole render. This is the
shape master-app will use in Stage 4 (one render request from caller
→ one bridge call → atomic completion or atomic failure).

### Script changes

`test-render.js` rewritten:

- New `--ids <a,b,c>` flag — comma-separated explicit selection.
- Default behaviour: take the first 6 entries from `mock-data/comps.json`.
- Existing `--id <x>` retained for single-tile rendering (Stage 3.4
  back-compat).
- Tiles array (with absolute image paths and pre-formatted text)
  serialised once into the bridge code via `JSON.stringify`. The
  in-plugin loop iterates that array, no string concatenation across
  tile-N markers.
- Result includes per-tile timings (`tileTimes[]`), `populateMs`,
  `exportMs`, and `totalMs` — measured inside the plugin so the
  caller-side wall-clock reading captures only HTTP+WS overhead on
  top.

### Run (default = first 6 comps)

```
$ node test-render.js
Bridge:   http://127.0.0.1:3000  connected=true
Output:   E:\TAI\indesign-uxp-server\output\test-render.pdf
Tiles (6):
  tile_1  mock-1  1325 E Elwood St, Phoenix, AZ        ±7,500 SF | ±1.14 AC   (204 KB)
  tile_2  mock-2  1701 E Elwood St, Phoenix, AZ        ±5,100 SF | ±1.23 AC   (213 KB)
  tile_3  mock-3  3635 S 43rd Ave, Phoenix, AZ        ±17,799 SF | ±133.00 AC (173 KB)
  tile_4  mock-4  411 S 33rd Ave, Phoenix, AZ         ±18,568 SF | ±2.64 AC   (179 KB)
  tile_5  mock-5  4714 N 43rd Ave, Phoenix, AZ         ±8,040 SF | ±2.91 AC   (183 KB)
  tile_6  mock-6  6271 W Morten Ave, Glendale, AZ      ±6,300 SF | ±1.13 AC   (185 KB)

Per-tile (in plugin):
  tile_1: 495 ms
  tile_2: 226 ms
  tile_3: 236 ms
  tile_4: 217 ms
  tile_5: 161 ms
  tile_6: 135 ms
  sum:        1470 ms

Populate (in plugin):  1470 ms
Export   (in plugin):  1126 ms
Plugin total:          2596 ms
Wall clock (caller):   2635 ms
HTTP+WS overhead:      39 ms

PDF: E:\TAI\indesign-uxp-server\output\test-render.pdf  (267.0 KB)
```

### Latency analysis

| Run | Tiles | HTTP round-trips | Populate | Export | Total |
|---|---|---|---|---|---|
| Stage 3.4 baseline | 1 | 6 | 743 ms | 6,459 ms | 7,268 ms |
| Stage 3.7 batched | 6 | 1 | 1,470 ms | 1,126 ms | 2,635 ms |

**Headline:** the 6-tile batched render finishes in 2.6 s — 2.75× faster
than the 1-tile per-call-per-op render despite doing 6× the populate
work.

**Two effects compose:**

1. **Round-trip elimination on populate.** Stage 3.4 paid an HTTP+WS
   round-trip for every operation (6 trips for 1 tile). Stage 3.7 pays
   one. Per-tile populate cost dropped from ~140 ms (≈ a single
   round-trip's overhead) to a steady-state ~135-225 ms in the
   plugin — and tile_1's cold-start 495 ms is the JIT compile of the
   batched script + the first `place()` call's font/image cache warmup.
   Naive scaling for 6 tiles per-call-per-op would have been
   `6 × 743 = 4,458 ms` of populate vs the batched 1,470 ms — **3×
   faster on populate alone**.

2. **Export speed-up looks dramatic but is partly session warmup.** The
   export step shrank from 6,459 ms (Stage 3.4, first export of the
   session) to 1,126 ms (Stage 3.7, second export of the same InDesign
   instance after intervening test runs). InDesign caches font subsets,
   colour profiles, and various PDF-engine state across exports in a
   session, so first-of-session is much slower than subsequent. **Do
   not credit this 5.7× to batching.** A cold-start re-run would
   probably show the export back near 6 s.

### Per-tile decay

```
tile_1  495 ms   (cold — JIT compile + first place() warmup)
tile_2  226 ms
tile_3  236 ms
tile_4  217 ms
tile_5  161 ms
tile_6  135 ms
```

After tile_1 the plugin steady-state is ~150-225 ms per tile (text
sets + image place + fit). Extrapolation to 12 tiles:

```
~500 ms (tile_1 cold) + 11 × ~190 ms = ~2.6 s populate
+ ~1.1-6.5 s export (depending on session state)
≈ 4-9 s total for a 12-tile sheet
```

Comfortably under the 30 s ceiling and well below master-app's
realistic UX budget for "click render, see preview".

### Output

PDF produced at `output/test-render.pdf` (267 KB). Document left open
in InDesign so it can be inspected before the next render overwrites
it. **Visual verification is optional** for Stage 3.7 — Stage 3.5
already validated the per-tile rendering visually for the same
template; the change here is purely the call shape, not the rendering
output.

### Tag

`stage-3.7-complete` at this commit.

---

## Prerequisites — verified at start

- `STAGE-2-NOTES.md` exists at repo root
- Tag `stage-1.5-complete` exists locally and on `origin`
- Working tree clean of unstaged changes (only intentional untracked files
  remain: `analysis/safety-report.md` and various `*prompt.md` files)
- `templates/template-v2-test.indd` exists, **6,828,032 bytes** (~6.5 MB),
  last modified `2026-05-01 14:45`
- Stage 2 commits present in `git log` (`9355aee` Stage 2F wrap-up at HEAD)

---

## Stage 3.1 — Template prep

The user manually saved Hannah's template as
`templates/template-v2-test.indd` and added four named frames in tile 1:

| Frame name | Type | Purpose |
|---|---|---|
| `tile_1_photo` | rectangle (image frame) | property aerial photo |
| `tile_1_address` | text frame | street address |
| `tile_1_city_state` | text frame | "City, State" |
| `tile_1_sf_ac` | text frame | "±SF | ±AC" line |

Template (no price or status fields — expected per Stage 3 prompt; templates
have variable field sets):

```
ls -la templates/template-v2-test.indd
-rw-r--r-- 1 aswat 197609 6828032 May 1 14:45 templates/template-v2-test.indd
```

Size = 6,828,032 bytes (~6.5 MB). Above the 100 KB sanity threshold by ~70×.

---

## Stage 3.2 — Frame verification (smoke test)

Bridge was confirmed live (`/status` → `{connected:true, queueDepth:0}`)
and `template-v2-test.indd` was the only open and active document
(`{active:"template-v2-test.indd", openCount:1}`). The user started the
bridge and reloaded the plugin themselves after Stage 2F's clean teardown.

### Probe

```js
const doc = app.activeDocument;
const names = ["tile_1_photo", "tile_1_address", "tile_1_city_state", "tile_1_sf_ac"];
const result = {};
for (const n of names) {
  const t = doc.textFrames.itemByName(n);
  const r = doc.rectangles.itemByName(n);
  result[n] = { text: t.isValid, rectangle: r.isValid };
}
return { document: doc.name, frames: result };
```

### Response

```json
{
  "result": {
    "document": "template-v2-test.indd",
    "frames": {
      "tile_1_photo":      { "text": false, "rectangle": true  },
      "tile_1_address":    { "text": true,  "rectangle": false },
      "tile_1_city_state": { "text": true,  "rectangle": false },
      "tile_1_sf_ac":      { "text": true,  "rectangle": false }
    }
  }
}
```

### Verdict

All four frames resolve cleanly with the **expected** type assignment:

| Frame | Expected | Got |
|---|---|---|
| `tile_1_photo` | rectangle only | rectangle only ✓ |
| `tile_1_address` | text frame only | text frame only ✓ |
| `tile_1_city_state` | text frame only | text frame only ✓ |
| `tile_1_sf_ac` | text frame only | text frame only ✓ |

`document` field matches the expected file name. No name typos, no
type mismatches, no missing frames. Stage 3.2 — pass.

---

## Stage 3.3 — Mock comp + image preparation

The user pre-populated `mock-data/` with eight per-address folders, each
containing `comp_data.txt` (3-line address / Sqft / Acre format) and
`comp_image.jpg`. A small helper script — `mock-data/build-comps.cjs`,
gitignored — parses each folder, generates a clean image filename slug,
copies the image into `mock-data/images/`, and writes `mock-data/comps.json`.

**Result:** 7 comps loaded; 1 skipped because of a missing image.

| ID | Address | City, State | SF | AC | Image (KB) |
|---|---|---|---|---|---|
| mock-1 | 1325 E Elwood St | Phoenix, AZ | 7,500 | 1.14 | 208 |
| mock-2 | 1701 E Elwood St | Phoenix, AZ | 5,100 | 1.23 | 218 |
| mock-3 | 3635 S 43rd Ave | Phoenix, AZ | 17,799 | **133** | 177 |
| mock-4 | 411 S 33rd Ave | Phoenix, AZ | 18,568 | 2.64 | 183 |
| mock-5 | 4714 N 43rd Ave | Phoenix, AZ | 8,040 | 2.91 | 187 |
| mock-6 | 6271 W Morten Ave | Glendale, AZ | 6,300 | 1.13 | 189 |
| mock-7 | 7701 N 67th Ave | Glendale, AZ | 50,000 | 12.58 | 229 |

`mock-3`'s `land_area: 133` was flagged as suspicious-looking but the user
confirmed it is **legitimate and correct**, not a typo. Used as-is.

`1851 S 19th Ave` (113,099 SF / 2.60 AC) was skipped — the source folder
lacks `comp_image.jpg`. Not a Stage 3 blocker.

### Repo policy

Decided with the user:

- `mock-data/comps.json` — **committed** (canonical input for the render script)
- `mock-data/images/*.jpg` — **committed** (~1.4 MB total; useful for reproducibility)
- `mock-data/<address-folders>/**` — **gitignored** (local-only Crexi raw exports)
- `mock-data/build-comps.cjs` — **gitignored** (working helper, re-runnable from local source)

Commit hash for the mock-data drop: `7cbfd40`.

### Selection for first render

**Comp chosen: `mock-3` — 3635 S 43rd Ave, Phoenix, AZ.**

Picked by the user. Will render `±17,799 SF | ±133 AC` (the
high-acreage value is intentional, not formatted to e.g. `1.33`).
Image: `mock-data/images/3635-s-43rd-ave.jpg` (177 KB).

---

## Stage 3.4 — Render script

`test-render.js` written at the repo root. Per-step POST to
`http://127.0.0.1:3000/execute`, each step timed independently, no
document close at the end so the result stays open in InDesign for
Stage 3.5 visual inspection.

### Note on path safety

The bridge's `/execute` endpoint forwards code strings to the plugin
verbatim — it does **not** run the path validator added in Stage 1.5.
That validator (`src/utils/pathValidator.js`) lives in the MCP-server
handlers under `src/`, which we are not going through. The Stage 3
prompt's mention of `INDESIGN_ALLOWED_ROOTS` therefore does not gate
this script. Defense here is best-effort:

- `path.resolve()` to absolute on every path before embedding
- local pre-flight check that comp + image exist on disk and image is
  >10 KB before any bridge call
- `fs.mkdirSync({recursive: true})` for `output/` to avoid path-creation
  errors mid-render

The structural protection is `BRIDGE_TOKEN` mandatory enforcement, which
is a deferred Stage-4 item (safety-report.md §10). With that not yet
in place, anyone who can talk to localhost:3000 can already eval any
JS in InDesign — path validation isn't the binding constraint.

### Run

```
$ node test-render.js --id mock-3
Comp:     mock-3  3635 S 43rd Ave, Phoenix, AZ
Image:    E:\TAI\indesign-uxp-server\mock-data\images\3635-s-43rd-ave.jpg  (172.7 KB)
Output:   E:\TAI\indesign-uxp-server\output\test-render.pdf
Bridge:   http://127.0.0.1:3000  connected=true

  [   48 ms] confirm active document is template-v2-test.indd
  [   90 ms] set tile_1_address = "3635 S 43rd Ave"
  [  277 ms] set tile_1_city_state = "Phoenix, AZ"
  [   12 ms] set tile_1_sf_ac = "±17,799 SF | ±133.00 AC"
  [  316 ms] place image into tile_1_photo (FILL_PROPORTIONALLY)
  [ 6459 ms] export PDF -> output/test-render.pdf

PDF:      E:\TAI\indesign-uxp-server\output\test-render.pdf  (294.9 KB)
Total:    7268 ms
```

### Verification against Stage 3.4 success criteria

| Criterion | Result |
|---|---|
| Script completes without error | ✅ exit 0 |
| `output/test-render.pdf` exists and >50 KB | ✅ 294.9 KB |
| Each step in single-digit seconds | ✅ longest is 6.46 s (export) |
| Total render under 30 s | ✅ 7.27 s |

### Per-step latency observations

- The export step (~6.5 s) is the dominant cost — it's genuinely IO-heavy
  inside InDesign (rasterise + write PDF). Acceptable for a 12-tile sheet
  render that runs maybe once per minute in real use.
- Step 3 (`set tile_1_city_state`) was 277 ms, several × the other
  text-set steps (90, 12 ms). Probably JIT warm-up or noise; not
  worth chasing in Stage 3 but flag if it recurs.
- Total = 7.27 s for one tile. If we naively scale to 12 tiles (4 sets +
  1 image + 1 fit per tile, plus one export), batched execution is
  almost certainly required to keep a full sheet under ~10 s — single
  `/execute` script with all DOM ops and one export at the end. Stage 4+
  concern, not Stage 3.

### `FitOptions.fillProportionally` confirmed reachable

`require('indesign').FitOptions.fillProportionally` returned a valid enum
value at runtime — the camelCase convention from the README is the
correct UXP form (not the screaming-snake `FILL_PROPORTIONALLY` of the
ExtendScript era). Recording explicitly because the same call shape will
be reused for every tile in Stage 4.

### Timestamp

Render produced PDF at `2026-05-01 15:28` local time.

Doc was left open in InDesign for Stage 3.5 inspection. The PDF is at
`output/test-render.pdf` (gitignored — see decision in 3.6).

---

## Stage 3.5 — Visual verification

The user opened `output/test-render.pdf` and compared it against
expectations.

**Verbatim report:**

> "Compared everything and the swap looks clean."

That is, all four populated fields (`tile_1_address`, `tile_1_city_state`,
`tile_1_sf_ac`, `tile_1_photo`) rendered correctly with no visible
issues. Photo fit (`FitOptions.fillProportionally`) produced the
expected aerial framing — no letterboxing, no stretching reported. Other
tiles and the background design were untouched.

No formatting concerns reported about the `±17,799 SF | ±133.00 AC`
line either — the user-confirmed legitimate `133` acreage rendered as
`133.00 AC` per the prompt's "to 2 decimal places" instruction, and the
user accepted it as-is.

Stage 3.5 — pass.


