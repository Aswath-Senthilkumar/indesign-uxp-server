# Template manifests

Per-template manifest JSON files, organized by workflow. The render
service scans this directory and registers each `manifest.json` found
under `<workflow>/<TemplateName>/manifest.json`.

```
template-manifests/
├── team-sheets/
│   ├── 6_Tile_Defaults/
│   │   ├── manifest.json
│   │   ├── README.md
│   │   └── render-mapping.ts        ← canonical comp → tile mapping (scaffold)
│   └── 18_Tile_Price_Status/
│       └── …
└── bov/
    └── (empty — BOV templates land here later)
```

**Workflow ids are path-derived.** The first-level folder name must
match a workflow id the service knows about (`team-sheets`, `bov`).
Folders that don't match a known workflow id are skipped with a
console warning.

## Where the .indd files live

**Not here.** `.indd` files are large (~200 MB) and live OUTSIDE the
repo, addressed by the `TEMPLATES_DIR` env var (see
`render-service/.env.example`). Manifests reference them by **filename
only**:

```json
{
    "id": "6-tile-defaults",
    "label": "6 Tiles template with defaults",
    "file": "6_Tile_Defaults.indd",
    ...
}
```

The service resolves the actual path as `${TEMPLATES_DIR}/${file}` via
a single helper (`render-service/core/template-paths.js`).

## Two update paths

This split — manifests in git, templates out of git — enables two
clean update flows:

| Change | What you do |
|---|---|
| Code or manifest change | `git pull` + restart the render service |
| Template `.indd` add or change | Drop the new/updated `.indd` into `TEMPLATES_DIR` + restart |

**A new template needs both** — its `.indd` (dropped into
`TEMPLATES_DIR`) AND its `manifest.json` (committed under
`template-manifests/<workflow>/<name>/`, arrives via `git pull`).
The `.indd` alone won't register without a manifest; the manifest
alone produces a "template file not found" error at render time
naming the expected `${TEMPLATES_DIR}/${file}` path.

## Manifest shape

```json
{
    "id": "kebab-case-unique-id",
    "label": "Human-readable name on the picker",
    "file": "<filename>.indd",
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
- `file` is the .indd filename only (no directory). Service resolves
  via `TEMPLATES_DIR`.
- `workflow` is NOT a field on the manifest — it's derived from the
  parent folder name.
- `grid.cols` (optional) — desktop column count hint for the picker
  UI's drag grid; falls back to a count-based heuristic when absent.
- Don't enumerate static frames in the manifest. `static_frames_note`
  is for humans only.

## Adding a new workflow

1. Add the workflow id to the registry in
   `render-service/core/manifest.js` (`WORKFLOW_IDS` set), plus the
   master-app UI's workflow registry if it has a corresponding picker.
2. Create `template-manifests/<workflow-id>/` and drop manifests under it.
3. Add the workflow's templates' `.indd` files to `TEMPLATES_DIR`.
4. Restart the render service.
