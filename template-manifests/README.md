# template-manifests

Per-template metadata organised by workflow. The render service scans this directory on startup and registers every `manifest.json` found under `<workflow>/<TemplateName>/manifest.json`.

```
template-manifests/
├── team-sheets/
│   ├── 6_Tile_Defaults/
│   │   └── manifest.json
│   └── 18_Tile_Price_Status/
│       └── manifest.json
└── bov/
    └── (BOV templates — added as sections are built)
```

## Why manifests are in git but .indd files are not

`.indd` files are large (~200 MB each) and exceed GitHub's per-file limit. They live **outside the repo**, addressed by the `TEMPLATES_DIR` env var. Manifests are small JSON and committed normally.

This split enables two independent update flows:

| Change | What you do |
|--------|-------------|
| Code or manifest change | `git pull` + restart render service |
| Template `.indd` add or change | Drop the file into `TEMPLATES_DIR` + restart render service |

**A new template needs both** — its `.indd` dropped into `TEMPLATES_DIR` AND its `manifest.json` committed here. The `.indd` alone won't register (no manifest); the manifest alone produces a "template file not found" error naming the expected path.

## Workflow IDs are path-derived

The first-level folder name must match a workflow ID registered in `render-service/core/manifest.js` (`WORKFLOW_IDS` set). Folders that don't match are silently skipped. Currently registered: `team-sheets`, `bov`.

## Manifest schema

```json
{
    "id": "kebab-case-unique-id",
    "label": "Human-readable name shown in the dashboard picker",
    "file": "TemplateName.indd",
    "grid": { "cols": 2 },
    "tile_fields": [
        { "field": "address",  "frame_pattern": "tile_{N}_address", "type": "text",  "required": true },
        { "field": "photo",    "frame_pattern": "tile_{N}_photo",   "type": "image", "required": true, "fit": "fillProportionally" },
        { "field": "sf_ac",    "frame_pattern": "tile_{N}_sf_ac",   "type": "sf_ac" },
        { "field": "price",    "frame_pattern": "tile_{N}_price",   "type": "price_line_v1" },
        { "field": "status",   "frame_pattern": "tile_{N}_status",  "type": "status_badge_v1" }
    ],
    "page_fields": [
        { "field": "title",   "frame": "page_title",   "type": "text", "editable": true },
        { "field": "tagline", "frame": "page_tagline", "type": "text", "editable": true }
    ],
    "static_frames_note": "Any prose notes for future readers about frames not covered above"
}
```

### Field rules

- `id` — unique across all workflows; used as the key in every API call
- `file` — filename only (no path). Service resolves via `${TEMPLATES_DIR}/${file}`
- `workflow` — NOT a field; derived from the parent folder name
- `grid.cols` — optional column hint for the dashboard drag-grid
- `tile_fields[].frame_pattern` — `{N}` is replaced by tile index (1-based) at render time
- `page_fields[].editable: true` — only editable fields are read by `/page-fields` and forwarded to the bridge
- `static_frames_note` — free-form text for humans; not parsed by the service

### Supported tile field types

| Type | Formatter | Notes |
|------|-----------|-------|
| `text` | none | Direct string |
| `image` | none | URL fetched, staged, placed with `fillProportionally` |
| `sf_ac` | `formatSfAc` | `±14,350 SF on ±1.88 AC` |
| `price_line_v1` | `formatPriceLine` | Handles sale-only, lease-only, dual |
| `status_badge_v1` | `formatStatusBadge` | `"PENDING"` → `"PENDING SALE"` |

## Adding a new workflow

1. Add the workflow ID to `WORKFLOW_IDS` in `render-service/core/manifest.js`
2. Create `template-manifests/<workflow-id>/`
3. Add template manifests under it
4. Drop matching `.indd` files into `TEMPLATES_DIR`
5. Restart the render service

## BOV templates

BOV sections do not use the manifest system for rendering — each section's route (`render-service/bov/routes/section{N}.js`) handles its own template resolution via `resolveTemplatePath` with a hardcoded manifest object. The `bov/` folder here is reserved for any future manifest-driven BOV sub-templates.
