# STAGE 2 NOTES

Working notes that come out of the pre-Stage-2 mitigation pass
(`pre-stage-2-prompt.md`). Each section corresponds to one item in the
prompt; items here either record verification outcomes or capture work that
is deferred to a later stage.

---

## Block 1 — Bridge binding

**Status:** No code change required. The bridge already binds to
`127.0.0.1` on both ports.

Verified by reading the source:

- `bridge/server.js:98` — `new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' })`
- `bridge/server.js:177` — `app.listen(HTTP_PORT, '127.0.0.1', () => { ... })`

There is no env-var override that would let either listener escape loopback,
and no configurable `host` in any of the calling code.

**Manual verification step for the human (post-mitigation):** start the
bridge and confirm with `netstat -an | findstr ":3000\|:3001"` (Windows) or
`lsof -i :3000` / `lsof -i :3001` (macOS / Linux) that both listeners show
`127.0.0.1:300x` rather than `0.0.0.0:300x` or `*:300x`. No commit was made
for this Block — there is nothing to change.

---

## Block 2 — Disable execute_indesign_code

**Status:** Done. Three registration sites and the handler body itself were
neutralized:

| Site | File:line | Change |
|---|---|---|
| MCP router case branch | `src/core/InDesignMCPServer.js:223` | commented out, with safety note |
| Tool definition exposed to MCP clients | `src/types/toolDefinitionsUtility.js:8` | object removed from `utilityToolDefinitions` |
| Help-system tool list | `src/handlers/helpHandlers.js:44` | `execute_indesign_code` removed from the `export` category |
| Handler method body | `src/handlers/utilityHandlers.js:12` | replaced with an unconditional `formatErrorResponse` ("disabled") |

### Concern 3 — verify executeScript fully disabled

`grep -rn "executeScript\|execute_indesign_code\|executeInDesignCode" src/`
returned six matches. Reviewed line by line:

```
src/core/InDesignMCPServer.js:219    // SAFETY: execute_indesign_code is disabled …  ← comment
src/core/InDesignMCPServer.js:223    // case 'execute_indesign_code': …               ← commented-out router
src/handlers/helpHandlers.js:44      // execute_indesign_code removed per …          ← comment
src/handlers/utilityHandlers.js:12   static async executeInDesignCode(args) {        ← disarmed body
src/handlers/utilityHandlers.js:17   'execute_indesign_code is disabled. …'          ← error string
src/types/toolDefinitionsUtility.js:8 // SAFETY: execute_indesign_code is disabled …  ← comment
```

Every active code path either does not exist (router branch is commented out,
tool definition is removed) or returns an error early (handler body). No
client of the MCP server can invoke arbitrary InDesign code through this
tool.

**Manual verification step for the human:** start the MCP server, list tools,
confirm `execute_indesign_code` is absent. Then attempt a `tools/call` with
`name: "execute_indesign_code"`. Expect a "Tool not found or not implemented"
error.

---

## Block 3 — Path traversal protection

**Status:** Done. New validator at
[`src/utils/pathValidator.js`](src/utils/pathValidator.js) (`validatePath`).
It resolves the path with `path.resolve`, rejects empty strings, NUL bytes,
and anything outside the allow-list, and is case-insensitive on Windows.

### Allow-list configuration

`INDESIGN_ALLOWED_ROOTS` env var. Comma- or semicolon-separated list of
absolute directories. **Defaults to `process.cwd()`** when unset, with a
stderr warning. The human should set this before running anything that
exercises file paths in production:

```
# bash / WSL
export INDESIGN_ALLOWED_ROOTS="/c/Users/Hannah/Templates,/c/Users/Hannah/Outputs"

# PowerShell
$env:INDESIGN_ALLOWED_ROOTS = "C:\Users\Hannah\Templates;C:\Users\Hannah\Outputs"
```

### Sites updated

Every handler that accepted a user-supplied path now calls `validatePath()`
before sending it to the InDesign DOM or to Node fs:

- `src/handlers/documentHandlers.js` — `openDocument`, `saveDocument`,
  `dataMerge` (also gates the `readFileSync` flagged in safety-report.md §4),
  `exportDocumentXml`
- `src/handlers/exportHandlers.js` — `exportPDF`, `exportImages`,
  `packageDocument`
- `src/handlers/graphicsHandlers.js` — `placeImage`
- `src/handlers/pageHandlers.js` — `placeFileOnPage`
- `src/handlers/bookHandlers.js` — `createBook`, `openBook`

Verified: `grep -rn 'JSON\.stringify\((filePath|folderPath|dataSource)\)'
src/handlers` returns zero matches — no handler embeds a raw user path into a
script string anymore.

### Manual verification step for the human

With `INDESIGN_ALLOWED_ROOTS` set to a known working directory, call any
path-accepting tool with a payload like `../../../etc/passwd` (or
`..\\..\\Windows\\System32\\drivers\\etc\\hosts`). Expect a
`formatErrorResponse` whose message ends in "outside the allowed roots …".

---

## Block 4 — npm audit verification (deferred to Stage 2A)

This is a verification step, not a code change. To run at the start of Stage
2A:

```bash
# from repo root
npm install --ignore-scripts
npm audit
# then in bridge/
cd bridge && npm install --ignore-scripts && npm audit
```

If either run reports **Critical** or **High** severity, stop and review with
the human before proceeding. Capture output of both `npm audit` runs in this
file under a "Block 4 — npm audit results" heading at that time.

---

## Concern 1 — Pin Node version

**Status:** Done.

- `package.json` already had `"engines": { "node": ">=18.0.0" }` (root MCP
  server). Unchanged.
- `bridge/package.json` was missing it. Added.

Both kept at `>=18.0.0` to match the bridge's syntax (top-level `await`
isn't used; ES2022+ features are used; AbortSignal.timeout in
`scriptExecutor.js` requires Node 17.3+).

---

## Concern 2 — Document manifest permissions reasoning

**Status:** Done. New file [`plugin/README.md`](plugin/README.md) covers
every declared permission, every permission deliberately not requested, and
the host/entrypoint constraints. `localFileSystem` is **not** added to the
manifest because the team-sheet flow exclusively uses InDesign-DOM file
calls (`new File()`, `doc.exportFile()`, `rect.place()`); the README
explains the conditions under which we'd add it later.

The README also flags that `network.domains: "all"` is wider than needed
(safety-report.md §1 Block) and recommends tightening to an array allow-list
before any shared-machine deployment. That tightening is **not** in the
pre-Stage-2 Block list, so it isn't applied yet — captured here as a
deferred item.

---

## Stage 2 verification additions (for Stage 2E)

Reminder for the Stage 2E lifecycle pass — these are tests, not changes to
make now:

- **Test 6 — Concurrent requests.** Send two render-shaped sequences
  (open document → setText → close) simultaneously. Document whether they
  interleave, queue, or error. Bridge has a serial queue
  (`bridge/server.js:34-95`) so the expectation is "they queue cleanly," but
  verify in practice.
- **Test 7 — Disconnect UX.** While the plugin is disconnected from the
  bridge, attempt a UI action that would normally send a message. Document
  the plugin's behavior — silent drop, error display, queue-and-retry, or
  freeze.

### Updated success criteria for Stage 2 ("What success looks like")

- Concurrent requests handled predictably (either serialized cleanly or
  rejected with clear error).
- Plugin disconnect UX is documented, even if the answer is "user sees
  nothing happen."

---

## Deferred to Stage 4 (recorded so they don't get lost)

- **Token-based auth between master-app and bridge.** Even on localhost,
  worth implementing for defense-in-depth and to support the eventual case
  where they run on different machines. The bridge already supports
  `BRIDGE_TOKEN` Bearer auth (`bridge/server.js:11-29`); making it
  *mandatory* (process.exit when unset) is the change still pending —
  flagged as Block in safety-report.md §10 but not included in the
  pre-Stage-2 Block list.
- **Concurrent-request handling strategy.** The lifecycle test in 2E will
  reveal how the plugin behaves; Stage 4 needs to design around that.
- **Reconnect-while-disconnected user experience.** What happens when a
  broker clicks "render" while InDesign is restarting? Stage 4 dashboard
  needs an answer.
- **`network.domains` tightening in `plugin/manifest.json`.** Change
  `"domains": "all"` to an explicit allow-list of `ws://127.0.0.1:3001` and
  `ws://localhost:3001`. Documented in `plugin/README.md` as a known
  follow-up.
