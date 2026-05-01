# STAGE 3 NOTES

End-to-end render of one comp through Hannah's template (`template-v2-test.indd`),
populating four named frames in tile 1, exporting to PDF.

Companion to `STAGE-2-NOTES.md`. Same structure: each sub-stage records the
verification step, raw output, and any findings worth surfacing for Stage 4.

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

