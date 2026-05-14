# Per-template setup

Templates are organized **by workflow**. The dashboard's manifest scanner
([dashboard/lib/manifest.ts](../lib/manifest.ts)) walks one level into
`dashboard/templates/`, treats each first-level folder as a workflow id,
and aggregates every per-template `manifest.json` it finds inside.

```
dashboard/templates/
├── team-sheets/
│   ├── 6_Tile_Defaults/
│   │   ├── manifest.json          ← required
│   │   ├── render-mapping.ts      ← optional (see below)
│   │   ├── README.md              ← optional
│   │   └── preview.png            ← optional (not yet wired)
│   └── 18_Tile_Price_Status/
│       └── …
└── bov/
    └── (empty until a BOV template lands)
```

**Workflow ids are path-derived.** The first-level folder name must match
a workflow id declared in [dashboard/lib/workflows.ts](../lib/workflows.ts)
(`team-sheets`, `bov`, …). Folders that don't match a known workflow id
are skipped with a console warning.

The Stage-8 workflow selection stage (`/build/workflow`) filters the
template picker's list to those declared for the selected workflow.

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

- `id` must be unique **across all workflows**.
- `file` is the .indd path relative to the **repo root** (e.g.
  `templates/6_Tile_Defaults.indd`), not relative to the per-template dir.
- `workflow` is NOT a field on the manifest — it's derived from the
  parent folder.
- `grid.cols` (optional) — desktop column count of the drag-grid on
  `/build/edit`. Falls back to a count-based heuristic when absent.
- `tile_fields[].format` (optional) — informational today; the
  runtime dispatches by `field` name.
- Don't enumerate static frames in the manifest. They're not surfaced
  in the dashboard; the `static_frames_note` is for humans only.

### `render-mapping.ts` — optional (scaffold)

Per-template canonical declaration of how a `Comp` record maps to the
tile-field values the bridge writes into named frames. The runtime
([dashboard/lib/render-script.mjs](../lib/render-script.mjs),
[dashboard/app/api/render/route.ts](../app/api/render/route.ts)) is
manifest-driven and dispatches by `field` name, so adding a new
field-set means adding a case in `resolveTileFieldValue()` in
`route.ts`. The mapping file is the contract that documents which
field names a template expects.

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
2. Identify the workflow it belongs to (`team-sheets`, `bov`, …).
3. Create `dashboard/templates/<workflow>/<TemplateName>/`.
4. Add `manifest.json` with the required fields.
5. (Optional) add `README.md`, `render-mapping.ts`, `preview.png`.
6. Restart the dev server — the manifest cache reloads on next module
   import.

If the new template uses tile fields the runtime already knows
(address, city_state, sf_ac, photo, price, status), no code changes
are needed. If it introduces a new field name, add a case in
`resolveTileFieldValue()` in [route.ts](../app/api/render/route.ts).

## Adding a new workflow

1. Add the workflow id + metadata to
   [dashboard/lib/workflows.ts](../lib/workflows.ts).
2. Create the matching folder under `dashboard/templates/<workflow-id>/`.
3. Drop templates into it.
4. Restart the dev server.

The workflow picker reads `WORKFLOWS` directly — the new entry will
surface on `/build/workflow` automatically (gated by its `available`
flag).
