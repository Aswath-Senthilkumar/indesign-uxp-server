# InDesign UXP Automation Server

> **Forked from** [zachshallbetter/indesign-mcp-server](https://github.com/zachshallbetter/indesign-mcp-server) — rewritten to use Adobe's UXP plugin platform instead of AppleScript.

A multi-service system for automating Adobe InDesign document production. Supports two workflows:

- **Team sheets** — multi-tile comp sheets rendered from Supabase data via the MCP server or render service
- **BOV** (Broker Opinion of Value) — multi-section, multi-page documents assembled step-by-step in the dashboard

---

## System map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         dashboard (Next.js :4000)                    │
│  Build workflow              │           BOV workflow                │
│  (team-sheet picker + render)│  (7-step BOV document builder)        │
└──────────────┬───────────────┴──────────────┬────────────────────────┘
               │ HTTP proxies                  │ multipart/form-data
               ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    render-service (Express :8765)                     │
│  /render  /introspect  /page-fields  /preview  /status               │
│  /bov/cover/render  /bov/section1/render  …                          │
│                                                                       │
│  core/          teamsheet/          bov/                             │
│  (manifest,     (pipeline,          (cover,                          │
│   bridge-client, formatters,         section1,                       │
│   supabase,      validators)         section2…)                      │
│   images, …)                                                         │
└──────────────────────────────┬────────────────────────────────────────┘
                                │ HTTP POST /execute (code strings)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       bridge (Express :3000 + WS :3001)               │
│  Serial execution queue · 30s timeout · BRIDGE_TOKEN auth             │
└──────────────────────────────┬────────────────────────────────────────┘
                                │ WebSocket
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              UXP Plugin (inside Adobe InDesign)                       │
│  new Function('app', `return (async () => { code })()`)(app)          │
└──────────────────────────────┬────────────────────────────────────────┘
                                │
                                ▼
                       InDesign DOM → PDF export

Separately:
┌──────────────────────────────────────────────────────────────────────┐
│               MCP Server (src/, stdio)                                │
│  ~135 tools exposed to Claude / Cursor / any MCP client              │
│  Uses same bridge → plugin chain                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Sub-project READMEs

| Directory | README | Description |
|-----------|--------|-------------|
| `bridge/` | [bridge/README.md](bridge/README.md) | HTTP + WebSocket relay; serial execution queue |
| `src/` | [src/README.md](src/README.md) | MCP server; ~135 tools; handler categories |
| `plugin/` | [plugin/README.md](plugin/README.md) | UXP plugin; code dispatch; permissions |
| `render-service/` | [render-service/README.md](render-service/README.md) | Full render service; all endpoints; env vars; curl test plan |
| `render-service/core/` | [render-service/core/README.md](render-service/core/README.md) | Shared substrate: bridge-client, manifest, images, Supabase |
| `render-service/teamsheet/` | [render-service/teamsheet/README.md](render-service/teamsheet/README.md) | Team-sheet pipeline; formatters; tile field types |
| `render-service/bov/` | [render-service/bov/README.md](render-service/bov/README.md) | BOV workflow; cover + section 1 complete; bridge patterns |
| `template-manifests/` | [template-manifests/README.md](template-manifests/README.md) | Manifest schema; workflow registration; .indd file split |
| `dashboard/` | [dashboard/README.md](dashboard/README.md) | Next.js app; Build + BOV workflows; API proxy routes |

---

## Why UXP vs AppleScript

This server is a ground-up rewrite of the AppleScript-based original. The execution model is fundamentally different.

| | AppleScript (original) | UXP (this fork) |
|---|---|---|
| **Platform** | macOS only | macOS + Windows |
| **Execution path** | Node → temp JSX file → AppleScript → InDesign | Node → HTTP → WebSocket → InDesign plugin |
| **Speed** | Slow — 3 hops, disk write per call | Fast — direct in-process call |
| **Reliability** | Flaky — breaks on focus loss or system dialogs | Stable — unaffected by focus or system state |
| **Return values** | Strings only | Full structured JSON |
| **JS version** | ExtendScript (ES3) | Modern JS (ES2015+, `async/await`) |
| **Error messages** | Cryptic AppleScript/OSA errors | Structured JSON with clear error strings |
| **Future-proofing** | ❌ Adobe deprecating ExtendScript/CEP | ✅ UXP is Adobe's official modern platform |

---

## Getting started

### Prerequisites

- Adobe InDesign 2024+ (UXP plugin support required)
- Node.js 18+
- A Supabase project with a `comps` table (for BOV and team-sheet data)

### 1. Install the UXP plugin

Load via **UXP Developer Tool** (Adobe Creative Cloud app):
```
plugin/manifest.json  ← point UXP Developer Tool here
```

In InDesign: `Window → Plugins → InDesign Bridge`

### 2. Start the bridge

```bash
cd bridge
npm install
node server.js
```

### 3. Start the render service

```bash
cd render-service
npm install
cp .env.example .env
# fill in SUPABASE_URL and SUPABASE_ANON_KEY
node server.js
```

Verify the bridge and plugin are connected:

```bash
curl http://127.0.0.1:8765/status
# { "connected": true, "queueDepth": 0 }
```

### 4. Start the dashboard

```bash
cd dashboard
pnpm install
# create .env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev
# http://localhost:4000
```

### 5. (Optional) Start the MCP server

For AI assistant integration (Claude, Cursor, etc.):

```bash
npm install   # from repo root
npm start
```

Configure your MCP client:
```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["/path/to/indesign-uxp-server/src/index.js"]
    }
  }
}
```

### Startup order

```
1. InDesign (open)
2. UXP plugin panel (open)
3. bridge            node server.js
4. render-service    node server.js
5. dashboard         pnpm dev
6. MCP server        npm start   (optional)
```

---

## Environment variables

### render-service/.env

| Variable | Default | Required |
|----------|---------|----------|
| `SUPABASE_URL` | — | Yes |
| `SUPABASE_ANON_KEY` | — | Yes |
| `PORT` | `8765` | No |
| `BRIDGE_URL` | `http://127.0.0.1:3000` | No |
| `TEMPLATES_DIR` | `../indesign-templates` (sibling dir) | No |
| `TEMPLATE_MANIFEST_DIR` | `../template-manifests` | No |
| `INDESIGN_REPO_ROOT` | parent of `render-service/` | No |
| `SERVICE_TOKEN` | unset (auth disabled) | No |

### dashboard/.env.local

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes |
| `RENDER_SERVICE_URL` | No (defaults to `http://127.0.0.1:8765`) |

### bridge (optional)

| Variable | Notes |
|----------|-------|
| `BRIDGE_TOKEN` | When set, require `Authorization: Bearer <token>` on `/execute` |

---

## Workflows

### Team sheets

Renders multi-tile InDesign templates populated with comp data from Supabase. The render service exposes `/render`, `/introspect`, `/page-fields`, and `/preview`. The dashboard provides a 4-step wizard (workflow → template → comps → edit + render).

See [`render-service/teamsheet/README.md`](render-service/teamsheet/README.md) for the full pipeline.

### BOV (Broker Opinion of Value)

A 7-step document builder in the dashboard. Each step renders one section of the BOV independently; the preview merges all sections in real time using `pdf-lib`.

| Step | Section | Status |
|------|---------|--------|
| 1 | Cover page | Complete |
| 2 | Section 1: Similar Transactions + Exec Summary + Pricing | Complete |
| 3–7 | Sections 2–6 | Pending |

See [`render-service/bov/README.md`](render-service/bov/README.md) for route details, frame names, and the patterns established in the completed sections.

---

## MCP tools (~135 total)

### Documents
`create_document` `open_document` `save_document` `close_document` `get_document_info` `get_document_preferences` `set_document_preferences` `get_document_elements` `get_document_styles` `get_document_colors` `get_document_layers` `get_document_stories` `get_document_hyperlinks` `create_document_hyperlink` `get_document_sections` `create_document_section` `get_document_grid_settings` `set_document_grid_settings` `get_document_layout_preferences` `set_document_layout_preferences` `get_document_xml_structure` `export_document_xml` `preflight_document` `validate_document` `cleanup_document` `data_merge` `save_document_to_cloud` `open_cloud_document` `view_document`

### Pages & Spreads
`add_page` `delete_page` `duplicate_page` `move_page` `get_page_info` `set_page_properties` `adjust_page_layout` `resize_page` `reframe_page` `navigate_to_page` `select_page` `zoom_to_page` `set_page_background` `create_page_guides` `place_file_on_page` `place_xml_on_page` `get_page_content_summary` `snapshot_page_layout` `delete_page_layout_snapshot` `delete_all_page_layout_snapshots` `list_spreads` `get_spread_info` `duplicate_spread` `move_spread` `delete_spread` `set_spread_properties` `create_spread_guides` `place_file_on_spread` `place_xml_on_spread` `select_spread` `get_spread_content_summary`

### Text & Tables
`create_text_frame` `edit_text_frame` `create_table` `populate_table` `find_replace_text` `find_text_in_document`

### Styles & Colors
`create_paragraph_style` `apply_paragraph_style` `create_character_style` `list_styles` `create_color_swatch` `list_color_swatches` `apply_color` `create_object_style` `list_object_styles` `apply_object_style`

### Graphics & Shapes
`place_image` `get_image_info` `create_rectangle` `create_ellipse` `create_polygon`

### Layers
`create_layer` `set_active_layer` `list_layers` `organize_document_layers`

### Page Items
`get_page_item_info` `select_page_item` `move_page_item` `resize_page_item` `set_page_item_properties` `duplicate_page_item` `delete_page_item` `list_page_items`

### Groups
`create_group` `create_group_from_items` `ungroup` `get_group_info` `add_item_to_group` `remove_item_from_group` `list_groups` `set_group_properties`

### Master Spreads
`create_master_spread` `list_master_spreads` `delete_master_spread` `duplicate_master_spread` `apply_master_spread` `get_master_spread_info` `create_master_text_frame` `create_master_rectangle` `create_master_guides` `detach_master_items` `remove_master_override`

### Export & Output
`export_pdf` `export_images` `export_epub` `package_document`

### Books
`create_book` `open_book` `list_books` `add_document_to_book` `synchronize_book` `repaginate_book` `export_book` `package_book` `preflight_book` `print_book` `get_book_info` `set_book_properties` `update_all_cross_references` `update_all_numbers` `update_chapter_and_paragraph_numbers`

### Utility
`execute_indesign_code` `get_session_info` `clear_session` `help`

---

## Testing (MCP server)

```bash
node tests/test-uxp-handlers.js   # 4 core handler tests
node tests/test-all-handlers.js   # full suite (27 tests)
```

Current status: **27/27 passing** across all handler categories.

---

## UXP API notes (for contributors)

- InDesign collections require `.item(n)` — bracket access `[n]` returns undefined
- `doc.filePath` is async — always `await` it in UXP code
- `exportFile(format, path)` — format arg is **first**
- Enums via `require('indesign')`: `ExportFormat.pdfType`, `FitOptions.fillProportionally`, etc.
- `OpenOptions.openCopy` — always use this for renders to avoid mutating the source template
- `$.writeln` is **ExtendScript only** — throws `ReferenceError` in UXP. Use `console.log`
- `para.contents = text` without a trailing `\r` strips the paragraph mark in UXP — use `tf.contents = lines.join('\r')` for multi-line frames

---

## License

MIT
