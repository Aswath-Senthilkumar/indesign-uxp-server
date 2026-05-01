# Plugin manifest — permissions reasoning

This file documents why each entry in [`manifest.json`](./manifest.json) is set
the way it is. It exists to answer "why does this plugin need that?" without a
reviewer having to chase the code.

## Declared permissions

### `network.domains`

Currently set to `"all"`:

```json
"network": { "domains": "all" }
```

**Why this is wider than it should be:** the plugin's only outbound
connection is the WebSocket to the local bridge
([`index.js:32`](./index.js)). It never talks to public internet, never
fetches assets, never authenticates against a remote service. The right shape
is a tight allow-list:

```json
"network": { "domains": ["ws://127.0.0.1:3001", "ws://localhost:3001"] }
```

**Status:** flagged in `analysis/safety-report.md` §1 as a Block-level concern.
The pre-Stage-2 mitigation list (`pre-stage-2-prompt.md`) does **not** require
it for the gate, so it is left as-is for now and tracked as a follow-up. We
should tighten it before the plugin is loaded on any shared machine.

### `allowCodeGenerationFromStrings`

Set to `true` because the plugin compiles JS code strings sent over the
WebSocket and runs them with the InDesign `app` global injected
([`index.js:22-29`](./index.js)). This is load-bearing — without it the plugin
has no way to dispatch operations. The structural mitigation lives at the
*bridge* boundary: the bridge requires `BRIDGE_TOKEN` Bearer auth, so only
processes that hold the token can submit code strings.

If we later replace the eval-string protocol with a fixed dispatch table of
named operations, this permission can be dropped — that's a Stage 4+
hardening, not Stage 2.

## Permissions we deliberately do NOT request

### `localFileSystem`

**Not declared.** All file operations in our flow (open template, save copy,
export PDF, place image) happen via the InDesign DOM, e.g.
`new File(path)` / `doc.exportFile(format, path)` / `rect.place(path)`. Those
calls run in InDesign's process and use InDesign's own file-access model —
they don't go through UXP's storage API.

If we ever need the plugin itself to read or write files directly from JS
(parse a CSV, stream a log to disk, scan a templates folder), we'd add
`"localFileSystem": "fullAccess"`. The reasoning would be:

- Hannah's InDesign templates may live in OneDrive-synced or
  user-chosen folders that vary per machine.
- Exported PDFs go to user-specified output paths, not a fixed
  plugin-managed directory.
- The narrower `extensions-only` scope confines reads/writes to the
  plugin's own data directory and doesn't fit either of the above.

We are choosing **not** to request `localFileSystem` until a concrete handler
needs it. Principle of least privilege.

### `clipboard`, `webview`, `enableSWCSupport`, `launchProcess`

**Not declared.** The plugin doesn't touch the clipboard, doesn't render web
views, doesn't load Spectrum Web Components, doesn't shell out. None are
needed for the team-sheet render flow.

## Host constraints

```json
"host": { "app": "ID", "minVersion": "18.0" }
```

`18.0` = InDesign 2023. Adobe shipped UXP plugin support for InDesign in 2023.
Our team standardizes on InDesign 2024+ but the manifest stays at 18.0 to
avoid blocking developers on older minor versions during testing.

## Entrypoints

A single panel (`mainPanel`). No menu commands, no document-event hooks. The
WebSocket is opened only when the user shows the panel
([`index.js:70-87`](./index.js)). If the user closes InDesign or never opens
the panel, the plugin is inert.
