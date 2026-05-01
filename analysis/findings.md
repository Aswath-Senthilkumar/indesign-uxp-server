# indesign-uxp-server — Analysis for Team-Sheet Project

Read pass dated 2026-04-30 against branch `analysis/initial-pass` at commit `de21c56`. Goal: decide whether to fork-and-strip, reference-and-rewrite, or fork only the plugin.

---

## Section 1: Repository inventory

```
indesign-uxp-server/
├── README.md                    architecture overview, ~130 tools listed
├── LICENSE                      MIT (2025 lucdesign)
├── CONTRIBUTING.md
├── changes.2026-03-06.md        incident note: bridge auto-spawn fix
├── package.json                 type: module; one dep — @modelcontextprotocol/sdk
├── package-lock.json
├── index.js                     thin redirect → src/index.js
├── .planning/                   stale roadmap notes (last touched 2026-02-26)
├── docs/                        CHANGELOG.md, LLM_PROMPT.md, MCP_INSTRUCTIONS.md
├── plugin/                      ★ UXP plugin source — only 3 files
│   ├── manifest.json            permissions + entry point
│   ├── index.html               9 lines: <p id="status"> + <script>
│   └── index.js                 90 lines: WebSocket client + generic eval
├── bridge/                      ★ Node bridge
│   ├── server.js                181 lines: HTTP :3000, WS :3001
│   ├── package.json             deps: express, ws, uuid
│   └── package-lock.json
├── src/                         ★ MCP server
│   ├── index.js                 ensureBridge() then start MCP
│   ├── core/
│   │   ├── InDesignMCPServer.js MCP setup + giant switch dispatch (130+ cases)
│   │   ├── scriptExecutor.js    POSTs JS code strings to bridge /execute
│   │   └── sessionManager.js    in-memory page-dim cache + smart positioning
│   ├── handlers/                13 files, ~6.3k LOC, one class per category
│   │   ├── documentHandlers.js  (1236 lines — by far the largest)
│   │   ├── pageHandlers.js      (530)
│   │   ├── graphicsHandlers.js  (546)
│   │   ├── bookHandlers.js      (480)
│   │   ├── textHandlers.js      (376)
│   │   ├── helpHandlers.js      (346) — static help text
│   │   ├── styleHandlers.js     (339)
│   │   ├── masterSpreadHandlers.js (329)
│   │   ├── groupHandlers.js     (310)
│   │   ├── pageItemHandlers.js  (258)
│   │   ├── exportHandlers.js    (154)
│   │   └── utilityHandlers.js   (99)
│   ├── types/                   tool schemas, split by category (10 files, ~2k LOC)
│   └── utils/stringUtils.js     escapeJsxString (legacy), formatResponse
└── tests/                       21 .js files, ~21k LOC of integration tests
                                 (require running bridge + InDesign)
```

- **UXP plugin source:** [plugin/](../plugin/) (only 3 files)
- **Bridge / WebSocket server:** [bridge/server.js](../bridge/server.js)
- **MCP server:** [src/](../src/), entrypoint [src/index.js](../src/index.js)
- **Tests:** [tests/](../tests/) — all live integration tests; nothing mocked
- **Manifest:** [plugin/manifest.json](../plugin/manifest.json)
- **Build/bundling:** none. Plain ESM Node + plain HTML/JS plugin. `npm run build` is a placeholder echo.
- **Behavior-gating config:** Hardcoded ports `3000` (HTTP) and `3001` (WS) in [bridge/server.js:5-6](../bridge/server.js#L5-L6) and [src/core/scriptExecutor.js:4](../src/core/scriptExecutor.js#L4). Optional `BRIDGE_TOKEN` env var enables Bearer auth ([bridge/server.js:11](../bridge/server.js#L11), [src/core/scriptExecutor.js:7](../src/core/scriptExecutor.js#L7)). 30s execution timeout in bridge ([bridge/server.js:7](../bridge/server.js#L7)), 35s in MCP fetcher ([src/core/scriptExecutor.js:30](../src/core/scriptExecutor.js#L30)).

---

## Section 2: License and provenance

- **License:** MIT, "Copyright (c) 2025 lucdesign" — [LICENSE:1-3](../LICENSE#L1-L3). Permissive; we can fork freely.
- **Author of this fork:** `lucdesign` (per [package.json:28](../package.json#L28) and [README.md:217](../README.md#L217)).
- **Original upstream:** `zachshallbetter/indesign-mcp-server` per [README.md:3](../README.md#L3). The original was AppleScript-based; this fork is a ground-up rewrite to UXP. The README's "Why UXP vs AppleScript" table ([README.md:9-28](../README.md#L9-L28)) is essentially the change-log of the fork: replaced a `Node → tempfile.jsx → AppleScript → InDesign` chain with `Node → HTTP → WebSocket → UXP plugin`.
- **Most recent commit:** `de21c56 chore: bump version to 2.0.0`. The repo has 34 commits total; the run-up to 2.0 (commits `b10e50a` … `ab1be00`) bundles a "Codex audit" series of security and reliability fixes (C1/C2 injection, H1/H2/H6, M3-6, L1-5). That's encouraging: someone has already iterated on hardening.

---

## Section 3: The plugin layer in detail

This is the most important read — and it's tiny.

### Structure

[plugin/manifest.json](../plugin/manifest.json):
- `manifestVersion: 5`, `id: com.ads.indesign-bridge`, single panel entry point `mainPanel`.
- Host: InDesign (`ID`), `minVersion: "18.0"` — i.e. InDesign 2023+. The README's claim of "InDesign 2024+" is more conservative than what the manifest enforces.
- **Permissions:**
  - `network: { domains: "all" }` ([plugin/manifest.json:18-21](../plugin/manifest.json#L18-L21)) — overbroad. The plugin only ever connects to `ws://127.0.0.1:3001`. Should be `domains: ["ws://127.0.0.1:3001"]`.
  - `allowCodeGenerationFromStrings: true` — required because the plugin's whole architecture is `new Function('app', code)`. This is the load-bearing permission and it is also the one most likely to make a security reviewer raise an eyebrow.
- No `localFileSystem` permission. Path-based `place()` and `exportFile()` work via the InDesign DOM, not the UXP fs API, so this is fine — but if we ever want to write JSON/log files from the plugin itself, we'd need to add it.

### Bootstrap and dispatch

[plugin/index.html](../plugin/index.html) is 9 lines: a status `<p>` and a `<script src="index.js">` tag.

[plugin/index.js](../plugin/index.js) is the entire plugin:
- Imports `app` from `'indesign'` and `entrypoints` from `'uxp'`.
- `entrypoints.setup({ panels: { mainPanel: { show() { ...; connectToBridge() } } } })` — connection only opens when the panel is *shown*. If the user never opens the panel, nothing connects.
- `connectToBridge()` ([plugin/index.js:31-66](../plugin/index.js#L31-L66)): plain `new WebSocket("ws://127.0.0.1:3001")`. On `close` it retries unconditionally with `setTimeout(connectToBridge, 3000)` — fixed 3s, no jitter, no exponential back-off, no max retries. That's fine for a localhost bridge but means a perpetually-failing bridge produces a console-error storm.

### Operation surface

There is **no operation surface** in the plugin itself. Inbound messages are handled in two cases ([plugin/index.js:50-54](../plugin/index.js#L50-L54)):
- `type === 'ping'` → reply `pong`.
- `type === 'execute'` → call `handleExecute(ws, msg)`.

`handleExecute` ([plugin/index.js:20-29](../plugin/index.js#L20-L29)) is the entire operation router:
```js
const fn = new Function('app', `return (async () => { ${msg.code} })()`);
const result = await fn(app);
ws.send(JSON.stringify({ type: 'result', id: msg.id, result: serializeResult(result) }));
```

So every operation — every `create_text_frame`, `place_image`, `export_pdf` — is just **a JS code string sent over the wire**, compiled with `new Function`, and run with `app` injected. The plugin contains zero domain logic. The MCP server is doing all the work; the plugin is a remote `eval()`.

### Patterns that look load-bearing

- **Async error handling:** the entire `handleExecute` is wrapped in one try/catch. Any throw inside the user code becomes a `{ type: 'error', error: e.message }` response. There's no global `unhandledrejection` listener, but because each execution is awaited inside the try, in practice errors do surface.
- **Named-frame handling:** the plugin doesn't address frames at all (it's a pure executor). The handlers do — see Section 6.
- **Multi-document state:** the plugin doesn't track this. Every handler in the MCP layer reads `app.activeDocument` and assumes it's the right one. There's no "currentDocId" or anything like it. If multiple documents are open, we are at the mercy of whichever one InDesign considers active.
- **DOM-call pattern:** direct DOM access. Helpers (`itemByName`, `.item(n)`) are used inline; there's no query/specifier abstraction.
- **UXP lifecycle hooks:** only `panels.mainPanel.show()`. No document open/close events, no panel-hide handler. If the user closes the panel, the WebSocket stays open (until the connection drops naturally), but there's no cleanup.
- **Result serialization:** [plugin/index.js:6-18](../plugin/index.js#L6-L18) does a `JSON.parse(JSON.stringify(value))` round-trip to flatten DOM proxy objects. This works for plain data but will quietly drop circular refs or methods. It's fine for the kinds of values we'll return.

### Tooling concerns

- **No build step.** Plugin loads as-is. Hot-reload is via UXP Developer Tool's "Reload" button — there is no watcher.
- **Debug logs** go to the UXP Developer Tool's plugin console (`console.log`/`console.error`). The bridge logs to stdout. There is no centralized log surface.
- The plugin is set up to be loaded in-development via UXP Developer Tool (per [README.md:64-72](../README.md#L64-L72)); production packaging (`.ccx`) is not addressed anywhere in the repo.

---

## Section 4: The bridge layer

[bridge/server.js](../bridge/server.js), 181 lines, single file.

- **Network shape:**
  - HTTP on `127.0.0.1:3000`, two endpoints: `GET /status` ([bridge/server.js:153](../bridge/server.js#L153), returns `{connected, queueDepth}`) and `POST /execute` ([bridge/server.js:157](../bridge/server.js#L157), takes `{code}`, returns `{result}` or error JSON).
  - WebSocket on `127.0.0.1:3001`, one connection at a time (a second plugin would overwrite `pluginSocket` — no rejection logic, [bridge/server.js:100-102](../bridge/server.js#L100-L102)).
- **Protocol:** JSON envelopes with a `type` discriminator. Bridge → plugin: `{type: 'execute' | 'ping', id, code}`. Plugin → bridge: `{type: 'result' | 'error' | 'pong', id, result|error}`. **The payload is a JS code string**, not a structured operation. Every message is "evaluate this expression."
- **Request/response correlation:** UUID-keyed `pending` map ([bridge/server.js:32](../bridge/server.js#L32), [bridge/server.js:115](../bridge/server.js#L115)). Each request gets a `setTimeout` of 30s; on timeout the entry is dropped and the requester rejected.
- **Concurrency:** explicit serial queue ([bridge/server.js:34-95](../bridge/server.js#L34-L95)). One execution in flight at a time across all callers. Comment at line 35-36 says this is to prevent concurrent DOM mutations from corrupting state — that's correct, the InDesign DOM is not thread-safe and concurrent UXP scripts can race. **Implication for us:** the bridge is a hard serial bottleneck. Two render jobs can't run in parallel — the second waits.
- **Disconnect handling:** on plugin `close` ([bridge/server.js:130-144](../bridge/server.js#L130-L144)), all in-flight pending entries get rejected with "Plugin disconnected", `processingQueue` is reset, and queued items get drained with the same error.
- **Rate limits / backpressure:** none. `/execute` enqueues immediately; the queue can grow without bound.
- **Caching:** none. The bridge is stateless aside from the queue.
- **Auth:** optional Bearer token via `BRIDGE_TOKEN` env ([bridge/server.js:11-29](../bridge/server.js#L11-L29)). If unset, prints a warning and accepts any caller. For our app this is fine on a single-user machine but we should set the token if multiple processes share it.

---

## Section 5: The MCP server layer

[src/core/InDesignMCPServer.js](../src/core/InDesignMCPServer.js), 238 lines, registers one giant `switch (name)` dispatch table covering ~130 tool names and routes each to a static handler method.

- **Tool count:** the README claims ~130; counting actual switch cases gives 117 implemented. Some tools listed in the README aren't wired up (e.g. the readme lists `apply_color`, `apply_character_style`, `find_replace_text` but also overlapping ones; the dispatch in [InDesignMCPServer.js](../src/core/InDesignMCPServer.js) is the source of truth).
- **Tool wrapping:** every tool is **1-to-1 with a single bridge `executeViaUXP(code)` call**. No tool composes multiple plugin operations. There is **no** `populate_template` or `render_team_sheet` super-tool — those would be ours to build.
- **Tool schemas:** hand-written JSON Schema in [src/types/toolDefinitions*.js](../src/types/) — 10 files, ~2k LOC. Not generated. Editing schemas means editing both the type file and the handler.
- **Coupling between MCP server and bridge:** zero. The MCP server only ever calls `ScriptExecutor.executeViaUXP(code)` ([src/core/scriptExecutor.js:21-49](../src/core/scriptExecutor.js#L21-L49)), which is a straight `fetch('http://127.0.0.1:3000/execute', {body: {code}})`. **Anyone can drop the MCP layer entirely and call the bridge directly via HTTP.** No coupling, no shared state. This is the most useful structural fact in the whole repo.

---

## Section 6: Gap analysis vs our needs

For each operation in our expanded set:

| Need | Status | Where |
|---|---|---|
| Open document | ✅ | `openDocument` [documentHandlers.js:182](../src/handlers/documentHandlers.js#L182) — calls `await app.open(file)`. |
| Close document | ✅ | `closeDocument` [documentHandlers.js:235](../src/handlers/documentHandlers.js#L235) — accepts `saveOptions: 'ASK'|'SAVE'|'DISCARD'`, maps to `SaveOptions.ask|yes|no`. Note: `'ASK'` opens the InDesign dialog and **blocks the UXP event loop** until dismissed; for headless use we always want `'DISCARD'` or `'SAVE'`. |
| Save as | ✅ | `saveDocument` [documentHandlers.js:203](../src/handlers/documentHandlers.js#L203) — accepts optional `filePath`. Refuses to save an unsaved document with no filePath (good). |
| **Set text in named text frame** | ❌ | **Not present.** All text ops address frames by index: `editTextFrame` uses `page.textFrames.item(${frameIndex})` ([textHandlers.js:153](../src/handlers/textHandlers.js#L153)), as does `applyParagraphStyle` ([styleHandlers.js:125](../src/handlers/styleHandlers.js#L125)). A grep for `textFrames.itemByName` returns zero hits. There is no operation that takes a frame name. **Closest existing thing:** `find_replace_text` ([textHandlers.js:336](../src/handlers/textHandlers.js#L336)), which works on the whole document. Adding `setTextByFrameName({pageIndex, name, content, ...})` is ~25 lines. |
| **Place image in named image frame with fitting** | ❌ | `placeImage` ([graphicsHandlers.js:260](../src/handlers/graphicsHandlers.js#L260)) creates a *new* rectangle at `(x, y, w, h)` then calls `rect.place(filePath)`. It does not look up an existing named frame, and it does **not** call any `FitOptions` after placing — `grep FitOptions` is empty across the whole repo. Image lands at native size, anchored at top-left of the new rect. Two missing pieces: (1) address by name; (2) call `rect.fit(FitOptions.proportionally)` (or `frameFittingOptions`) after place. ~20 lines combined. |
| Get/set frame fill color | 🟡 | `setPageItemProperties` ([pageItemHandlers.js:142](../src/handlers/pageItemHandlers.js#L142)) takes a `fillColor` *name* and looks it up via `doc.colors.itemByName(name)`. **It cannot take a freshly-built Color object** (RGB/CMYK array). For that, you'd first call `create_color_swatch` ([styleHandlers.js:232](../src/handlers/styleHandlers.js#L232)), then apply by name. This is the tax of going through the MCP API; if we go direct-to-bridge we can do both in one script. |
| Get/set frame stroke color | 🟡 | Same shape as fillColor, same constraint. |
| Get/set frame visibility | ✅ | `setPageItemProperties` accepts `visible` and `locked` ([pageItemHandlers.js:161-166](../src/handlers/pageItemHandlers.js#L161-L166)). `getPageItemInfo` returns them ([pageItemHandlers.js:34-35](../src/handlers/pageItemHandlers.js#L34-L35)). Indexed only. |
| Get frame geometry | ✅ | `getPageItemInfo` returns `geometricBounds` ([pageItemHandlers.js:36](../src/handlers/pageItemHandlers.js#L36)). Indexed. |
| Set frame geometry | ✅ | `movePageItem` ([pageItemHandlers.js:82](../src/handlers/pageItemHandlers.js#L82)) sets origin; `resizePageItem` ([pageItemHandlers.js:105](../src/handlers/pageItemHandlers.js#L105)) sets size. Indexed. There's no single "set geometricBounds to [y1,x1,y2,x2]" call; we'd compose move+resize. |
| Duplicate frame | ✅ | `duplicatePageItem` ([pageItemHandlers.js:179](../src/handlers/pageItemHandlers.js#L179)) — duplicates and moves to (x,y). |
| Add page | ✅ | `addPage` [pageHandlers.js:11](../src/handlers/pageHandlers.js#L11). |
| Remove page | ✅ | `deletePage` [pageHandlers.js:90](../src/handlers/pageHandlers.js#L90). |
| Apply master spread to page | ✅ | `applyMasterSpread({masterName, pageRange})` [masterSpreadHandlers.js:131](../src/handlers/masterSpreadHandlers.js#L131). Per-page, not per-spread; takes `'all'`, `'1-5'`, or `'3'`. |
| Export PDF with preset | ✅ | `exportPDF({filePath, preset})` [exportHandlers.js:11](../src/handlers/exportHandlers.js#L11). Calls `await doc.exportFile(ExportFormat.pdfType, filePath, false, preset)`. Preset is the *name* of an existing PDF export preset (e.g. `"High Quality Print"`); preset must already exist in InDesign. |
| **List named frames on a page** | 🟡 | `listPageItems` ([pageItemHandlers.js:227](../src/handlers/pageItemHandlers.js#L227)) returns `index, type, name, id, visible, locked, geometricBounds` for every item on a page. It walks `page.allPageItems`, so it covers text frames, rectangles, ovals, etc. **But:** the `type` field uses `item.constructor?.name` which is unreliable in UXP (often returns `"Object"`); and it returns *all* items, named or not. We can filter client-side. ~5 lines to add a "named only" variant. |
| **Native InDesign undo/redo** | ❌ | Not exposed. The repo comment at [documentHandlers.js:782-786](../src/handlers/documentHandlers.js#L782-L786) acknowledges that UXP doesn't have `app.doScript(..., UndoModes.fastEntireScript)` — instead, *each `executeViaUXP` call counts as one undo step* (InDesign labels it "Script" in history). Means: every render is one undo step (good), but we can't programmatically undo (no `app.undo()` wrapper). UXP does expose `app.activeDocument.undo()`/`redo()`; just not surfaced here. |
| **Master spread access (vs document pages)** | ✅ | `createMasterTextFrame` and `createMasterRectangle` ([masterSpreadHandlers.js:174](../src/handlers/masterSpreadHandlers.js#L174), [masterSpreadHandlers.js:226](../src/handlers/masterSpreadHandlers.js#L226)) explicitly target master spreads by name. `getMasterSpreadInfo` reports counts. So the layer differentiates correctly. |

### Specific spot checks the prompt called out

- **Named-frame addressing (`itemByName`).** `itemByName` is used heavily for *abstract* named collections — `paragraphStyles`, `characterStyles`, `objectStyles`, `colors`, `fonts`, `layers`, `masterSpreads`, `xmlElements` — but **never for `textFrames`, `rectangles`, `ovals`, or `allPageItems`**. Grep for `textFrames.itemByName` and `rectangles.itemByName`: zero matches across the whole repo. This is the single biggest gap for our use case, since our render pipeline depends on populating named frames in a template.
- **Image fitting.** No `FitOptions`, `.fit(`, `fitContentToFrame`, `fillProportionally`, `frameToContent` anywhere. `placeImage` leaves the image unfit.
- **PDF export presets.** Accepted as a string and passed through to `doc.exportFile(format, path, showOptions=false, preset)`. The preset must exist in the document or the user's InDesign preset list — there is no operation that creates or imports presets, so we'd need to ensure presets are pre-installed (or call `app.pdfExportPresets.add(...)` via `execute_indesign_code`).
- **Document close without save.** `closeDocument({saveOptions: 'DISCARD'})` maps to `SaveOptions.no`. Default is `'ASK'` which opens the system dialog — careful, that blocks. ([documentHandlers.js:255-256](../src/handlers/documentHandlers.js#L255-L256))
- **Color manipulation.** `setPageItemProperties.fillColor` requires an existing named swatch ([pageItemHandlers.js:152-154](../src/handlers/pageItemHandlers.js#L152-L154)). To use ad-hoc RGB, we have to `createColorSwatch` first. Going direct-to-bridge, we can build the Color in the same script.
- **Frame geometry.** Read works (`geometricBounds` returned by `getPageItemInfo`); write is split across `movePageItem` + `resizePageItem`. No single setter.
- **Page operations.** Add ✅, remove ✅, applyMaster ✅. Plus duplicate, move, resize, snapshot/restore.
- **Frame introspection.** `listPageItems` works; the `type` field is unreliable.
- **Master vs document pages.** Cleanly differentiated.

---

## Section 7: Concerns and red flags

1. **`allowCodeGenerationFromStrings: true` + `network.domains: "all"`.** The plugin is, by design, a remote eval running with broad network access. Any local process that talks to the bridge can run arbitrary InDesign DOM code in InDesign's process. The repo mitigates this with an *optional* `BRIDGE_TOKEN` env var ([bridge/server.js:11-15](../bridge/server.js#L11-L15)) but warns rather than enforces it. In a dev box this is fine; on a shared workstation we'd want to require the token. **If we go this route in master-app, master-app will be the only allowed caller — set `BRIDGE_TOKEN`.**
2. **Code-string injection surface in handlers.** Every handler builds a JS string by concatenating `${JSON.stringify(value)}` into a template literal. The audit commits already fixed C1/C2 injection vectors (commit `b10e50a`), and `JSON.stringify` is the right approach for primitives — but a hand-written tool is one missed `JSON.stringify` away from a SQL-injection-style flaw. Numeric template substitutions like `${frameIndex}` ([textHandlers.js:153](../src/handlers/textHandlers.js#L153)) bypass `JSON.stringify`; if `frameIndex` is ever a string from outside, it injects raw. This is a structural risk of the eval-strings model.
3. **Index-based frame addressing.** Every frame operation requires the caller to know which index a frame sits at on a page. For a 12-tile template that's brittle — a reorder in InDesign breaks our population code. We'd want named-frame addressing as the default, with `itemByName` lookups inside the script.
4. **`doc.pages.item(0)` hardcoded.** Several handlers default to page 0 and don't take a `pageIndex` arg — e.g. `editTextFrame` ([textHandlers.js:147](../src/handlers/textHandlers.js#L147)), `applyParagraphStyle` ([styleHandlers.js:123](../src/handlers/styleHandlers.js#L123)), `applyCharacterStyle`, `applyColor`, `populateTable`. For a single-page team-sheet template that's fine; for the multi-page extension it's a bug surface.
5. **`sessionManager.js` is a smell.** 544 lines of stateful "smart positioning" that calculates offsets when callers don't pass coordinates. Useful for a chat-driven LLM that says "put a rectangle"; useless and confusing for our deterministic populate flow. Multiple H4/H5 fix commits (`6509b31`) are about this same module: stale page dims and active-page mismatches. We should not depend on it.
6. **Fixed 3s reconnect, no jitter, no max retries.** Acceptable for localhost; if the bridge dies, the plugin will spam reconnect attempts forever.
7. **Long handler files.** [documentHandlers.js](../src/handlers/documentHandlers.js) is 1236 lines covering 25+ tools, many of which we won't need (XML structure, hyperlinks, sections, cloud, books). Easy to delete; just bulky.
8. **Tests need a live InDesign.** All ~21k LOC of tests under [tests/](../tests/) hit the bridge and exercise real InDesign. None mock. If we strip the MCP server, most of these tests become irrelevant (they exercise MCP→bridge, which is exactly the layer we'd drop).
9. **Versioning drift.** [package.json:3](../package.json#L3) reports `2.0.0`; [src/core/InDesignMCPServer.js:30](../src/core/InDesignMCPServer.js#L30) hardcodes `1.0.0` in the MCP server name. Cosmetic, but signals the codebase is not heavily curated.
10. **No `app.scriptPreferences.userInteractionLevel = NEVER_INTERACT` setup.** Means a stray modal dialog (font missing, link missing, save prompt) will block forever. We'd want to set this in our render scripts.

No `TODO`/`FIXME`/`HACK` markers in `src/` (clean).

---

## Section 8: Recommendation

**My recommendation: Option C — fork the plugin only, build our own bridge and write our own minimal handler library.**

Reasoning: the plugin is the actual hard part — figuring out the manifest, the panel lifecycle, the WebSocket reconnect loop, the `new Function(app, code)` evaluator pattern, and the JSON-safe serializer. That code is 90 lines and works. We can keep it almost verbatim. Everything *above* the plugin (the bridge, the MCP layer, the 130 tool wrappers, the session manager, the help system) is in our way:

- The MCP layer adds nothing for us — master-app is going to call the bridge directly, so the entire `src/` tree is dead weight.
- The 1-to-1 tool wrapping means each populate step is a separate HTTP roundtrip. For our flow we want one script that opens, populates 12 tiles × ~5 fields each, sets fitting on each image, exports PDF, closes — preferably as one bridge call so we get one undo step and minimal network chatter. None of the existing handlers compose like that; we'd be fighting them.
- Index-based addressing is the wrong primitive for templated populate. We need name-based lookups everywhere, and we'd be retro-fitting that across every handler.
- The bridge is fine but small enough to rewrite for our exact protocol (we may want operation-level batching, named ops rather than raw eval, structured logging for our own observability, request IDs that match master-app's job IDs).

**Effort estimate (Option C):**
- Keep: `plugin/` as-is, ~90 LOC. Possibly tighten the manifest's `network.domains` to just our localhost URL. Maybe rename and re-id.
- New bridge: ~150 LOC, similar shape (HTTP + WS, serial queue, request IDs, token auth required not optional).
- New handler library (in master-app or a small shared package): ~10 named operations: `openTemplate`, `populateNamedField`, `placeImageInNamedFrame`, `setFrameVisibility`, `exportPDF`, `closeDocument`, plus a `runScript` composite for one-shot render. ~300-500 LOC total.
- Total: **3-5 dev-days** for someone familiar with both Node and the InDesign DOM, including manual InDesign smoke-tests. Most of the time is testing, not coding.

**Pros / cons of each option:**

- **A. Fork-and-strip.** *Pros:* the cleanup of the security-audit commits comes along for free. *Cons:* deleting ~1200-line `documentHandlers.js` plus most of `pageHandlers.js`, all of `bookHandlers.js`, `helpHandlers.js`, `sessionManager.js`, plus most of `types/`, plus the giant switch — that's ~5000 LOC to delete. Then we still have to *modify* the surviving handlers to support named-frame addressing, image fitting, and composite ops. Estimated: ~6-8 dev-days, with a lot of low-value churn.
- **B. Reference-and-rewrite.** *Pros:* clean break, no inherited assumptions. *Cons:* we'd be re-deriving the plugin's manifest permissions and the `new Function(app, code)` pattern by hand from Adobe's docs. Marginally more risk than Option C. Estimated: ~4-6 dev-days. Honestly very close to Option C; the only real difference is whether we copy `plugin/index.js` literally or retype it.
- **C. Fork the plugin only.** *Pros:* keeps the one piece that's hard to get right (the UXP plugin scaffold) and discards everything that doesn't fit. We control our own bridge protocol and our own operation surface, so we can optimize for batched populate scripts from day one. *Cons:* we throw away the MCP-server tool catalogue, which we may discover useful as we go (e.g. `data_merge`, preflight). Easy to restore by lifting individual handler bodies.

Recommendation: **C.** It's the lowest total effort *and* the cleanest fit for our render pipeline.

---

## Section 9: Open questions

1. **Does `rect.place(filePath)` followed by `rect.fit(FitOptions.proportionally)` produce identical pixel output to InDesign's manual "Fitting → Fit Content Proportionally" command?** The repo doesn't test this. *Resolve:* run a 30-line UXP script in dev that places an image two ways (manual vs scripted) and diff the exported PDFs. Has to happen in real InDesign — flagged here, not attempted.
2. **What does `app.activeDocument` return when InDesign has no document open and another panel-driven action is in flight?** Several handlers guard with `if (app.documents.length === 0)` but the race window between document close and activeDocument refresh is unspecified. *Resolve:* Adobe's UXP forum or empirical testing.
3. **Is there a hard limit on the size of code strings the WebSocket frame will accept?** A populate-12-tiles script could be ~5-10 KB. Almost certainly fine but worth confirming. *Resolve:* construct a synthetic 100 KB script and try it.
4. **How does PDF preset resolution work across machines?** `exportFile(..., preset)` takes a preset name; presets live in InDesign's preferences, not in the document. *Resolve:* check whether Hannah's presets are document-embedded or user-account-level. We may need to ship a preset file and ensure it's installed at first run.
5. **What happens if a templated `.indd` is opened with missing fonts?** UXP will surface a font-substitution warning that, depending on `app.scriptPreferences.userInteractionLevel`, may block. *Resolve:* set `UserInteractionLevels.neverInteract` at the top of every render script and test against a deliberately-missing-font template.
6. **Is the master-app's render endpoint going to be invoked from a single process or multiple workers?** The bridge serializes everything globally; if our render flow scales horizontally we'll need either multiple InDesign instances (separate bridges) or our own queue in master-app. *Resolve:* ask the team about render concurrency targets.
7. **Will Hannah's templates use named frames already, or do we need a tooling pass to name them?** This determines whether the gap in Section 6 (no `textFrames.itemByName` usage) costs us "30 LOC of new handlers" or "30 LOC + a Hannah-on-InDesign onboarding session."
8. **What's our policy on undo?** If a broker edits a populated sheet and wants to undo, do we want one undo per script call (current UXP default), or finer-grained? Determines whether we wrap each setter in a bookmark/script grouping or just live with the default.

---

## One-paragraph summary

The repo is a clean, MIT-licensed UXP fork of an older AppleScript MCP server. Architecturally it's three layers — UXP plugin (90 LOC, generic JS-eval), Node bridge (181 LOC, serial-queued HTTP/WS relay), and MCP server (~6 KLOC of 1-to-1 tool wrappers). The plugin is the only piece that's both load-bearing and hard to get right; the bridge is small and well-scoped; the MCP layer is mostly noise for our use case. The biggest functional gap is that no operation addresses page items by name — every `editTextFrame`, `applyStyle`, `applyColor`, `placeImage` works by index, which is the wrong primitive for templated team-sheet population. `placeImage` also doesn't fit images, and color setters require pre-existing swatches. None of these are hard to fix; all are wrong defaults for our pipeline. **Recommendation: fork only the `plugin/` folder (Option C), write a small new bridge with mandatory auth, and build ~10 named operations directly against the InDesign DOM in our own handler library — total estimated effort 3-5 dev-days.** Before committing, resolve the open questions above, especially #1 (image-fit fidelity) and #4 (PDF preset deployment).
