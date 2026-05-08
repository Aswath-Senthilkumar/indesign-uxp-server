# Per-template setup

Each template the dashboard supports lives in a folder named after its
`.indd` file (without extension). The dashboard's manifest scanner
(`dashboard/lib/manifest.ts`) walks this directory at module load and
aggregates every entry it finds.

```
dashboard/templates/
└── <TemplateName>/
    ├── manifest.json          ← required
    ├── render-mapping.ts      ← optional (see below)
    ├── README.md              ← optional
    └── preview.png            ← optional (not yet wired)
```

## File catalogue

### `manifest.json` — required

Consumed at runtime to drive the picker, comp gating, the tile-grid
layout, page-field inputs, and the render API's frame mapping.

```json
{
    "id": "kebab-case-unique-id",
    "label": "Human-readable name on the picker",
    "file": "templates/<filename>.indd",
    "grid": { "cols": 2 },
    "tile_fields": [
        { "field": "address", "frame_pattern": "tile_{N}_address", "type": "text", "required": true },
        { "field": "photo",   "frame_pattern": "tile_{N}_photo",   "type": "image", "required": true, "fit": "fillProportionally" }
    ],
    "page_fields": [
        { "field": "title", "frame": "page_title", "type": "text", "editable": true }
    ],
    "static_frames_note": "free-form prose for the next reader"
}
```

- `grid.cols` (optional) — desktop column count of the drag-grid on
  `/build/edit`. Falls back to a count-based heuristic when absent.
- `tile_fields[].format` (optional) — informational today. Will drive
  the manifest-driven render path once a second template motivates
  the refactor.
- Don't enumerate static frames in the manifest. They're not surfaced
  in the dashboard; the `static_frames_note` is for humans only.

### `render-mapping.ts` — optional (scaffold)

Per-template mapping from comp data to the tile-field populate steps
the bridge code will run. Currently a **documentation/contract file** —
the runtime render code (`dashboard/lib/render-script.mjs` and
`dashboard/app/api/render/route.ts`) is hardcoded to the field shape
used by 6_Tile_Defaults. When a template arrives that uses
different tile fields (e.g., `status`, `price`), the runtime will be
refactored to consume this file, and the export shape here becomes the
canonical declaration.

Until then, this file is present for templates that want to ship the
canonical shape early so the second template's PR is mostly "drop the
folder and test."

### `README.md` — optional

Template-specific notes for humans (Hannah, Liam, future engineers):
what the layout looks like, what static frames are present, what
copy-style decisions are baked in, any quirks.

### `preview.png` — optional, not yet wired

Static hero image for the template picker card. Future feature — the
picker today shows label + chips. When this is wired up the card will
render this image at the top.

## Adding a new template

1. Drop the `.indd` into `templates/` (repo root).
2. Create `dashboard/templates/<TemplateName>/`.
3. Add `manifest.json` with the required fields.
4. (Optional) add `README.md`, `render-mapping.ts`, `preview.png`.
5. Restart the dev server — the manifest cache reloads on next module
   import.

If the new template uses the same four tile fields as
6_Tile_Defaults (address, city_state, sf_ac, photo), no code
changes are needed. If it uses different fields, the runtime needs
the refactor to consume `render-mapping.ts` first.
