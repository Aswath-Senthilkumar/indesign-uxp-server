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
