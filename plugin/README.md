# plugin — UXP InDesign Plugin

The Adobe InDesign UXP plugin that runs inside InDesign and connects to the bridge server. This is the innermost layer of the execution chain — every tool call and every render eventually arrives here.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | UXP plugin manifest (id, host version, permissions, entrypoints) |
| `index.js` | Plugin logic — WebSocket client, code dispatch, heartbeat |
| `index.html` | Panel UI (minimal — status indicator only) |

## How it works

1. When the panel is opened in InDesign (`Window → Plugins → InDesign Bridge`), `index.js` opens a WebSocket connection to `ws://127.0.0.1:3001`
2. The bridge sends `{ type: "execute", code: "...", id: "..." }` messages
3. The plugin runs each code string as:
   ```js
   new Function('app', `return (async () => { ${code} })()`)(app)
   ```
4. The result is `JSON.stringify`'d and sent back to the bridge as `{ type: "result", id, result }`
5. A ping/pong heartbeat keeps the connection alive between calls

The `app` global gives the code string full access to the InDesign DOM — documents, pages, frames, styles, export functions.

## Code execution safety

Code strings are trusted — they come from the bridge which can require `BRIDGE_TOKEN` auth. The structural mitigation is at the bridge boundary, not inside the plugin. See `bridge/README.md` for auth details.

The `allowCodeGenerationFromStrings` permission is load-bearing for the `new Function()` dispatch. If the protocol is ever changed to a fixed dispatch table, this permission can be dropped.

## Permissions declared in `manifest.json`

### `network.domains: "all"`

The plugin's only outbound connection is the WebSocket to the local bridge. The permission is intentionally broader than needed. The tighter form would be:

```json
"network": { "domains": ["ws://127.0.0.1:3001", "ws://localhost:3001"] }
```

This is tracked as a hardening follow-up — it should be tightened before the plugin is deployed on any shared machine.

### `allowCodeGenerationFromStrings: true`

Required for `new Function()`. Without it, code dispatch is impossible. The bridge's `BRIDGE_TOKEN` auth is the mitigating control.

## Permissions deliberately NOT declared

| Permission | Reason not needed |
|------------|-------------------|
| `localFileSystem` | All file operations (open template, export PDF, place image) use the InDesign DOM (`doc.exportFile`, `rect.place`) which runs in InDesign's process — not through UXP's storage API |
| `clipboard` | No clipboard access needed |
| `webview` | No web views needed |
| `launchProcess` | No shell-out needed |

## Host constraints

```json
"host": { "app": "ID", "minVersion": "18.0" }
```

`18.0` = InDesign 2023 (first version with UXP plugin support). The team uses InDesign 2024+ but the manifest stays at `18.0` to avoid blocking developers on older minor versions during testing.

## Entrypoints

A single panel (`mainPanel`). No menu commands, no document event hooks. The WebSocket is opened only when the user shows the panel. If InDesign is open but the panel is closed, the plugin is completely inert.

## UXP API notes

- InDesign collections require `.item(n)` — bracket access `[n]` returns undefined
- `doc.filePath` is async — always `await` it
- Enums via `require('indesign')`: `ExportFormat.pdfType`, `FitOptions.fillProportionally`, etc.
- `exportFile(format, path)` — format arg is first (same as ExtendScript)
- `OpenOptions.openCopy` opens a fresh copy — use this for renders to avoid mutating the source template
- `$.writeln` is ExtendScript only — not available in UXP. Use `console.log` for debug output

## Installation

Load via **UXP Developer Tool** (Adobe Creative Cloud app):
1. Open UXP Developer Tool
2. Add plugin → point to `plugin/` folder
3. Click **Load**
4. In InDesign: `Window → Plugins → InDesign Bridge`
5. The panel shows "Connected to bridge ✓" when the bridge is running
