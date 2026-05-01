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

## Block 4 — npm audit verification (executed during Stage 2A)

### Tooling versions

```
node --version   v24.11.1
npm --version    11.12.0
```

### bridge/ install

```
$ cd bridge && npm install --ignore-scripts
added 70 packages, and audited 71 packages in 2s
16 packages are looking for funding
2 vulnerabilities (1 moderate, 1 high)
```

No prepare/postinstall hooks ran (verified by `--ignore-scripts` and by
re-grepping the lockfile dependencies pre-install).

### bridge/ audit results

```
$ npm audit
# npm audit report

path-to-regexp  <0.1.13                                                    HIGH
  Regular Expression Denial of Service via multiple route parameters
  https://github.com/advisories/GHSA-37ch-88jc-xwx2
  fix available via `npm audit fix`
  node_modules/path-to-regexp

uuid  <14.0.0                                                              MODERATE
  Missing buffer bounds check in v3/v5/v6 when buf is provided
  https://github.com/advisories/GHSA-w5hq-g745-h8pq
  fix available via `npm audit fix --force` (breaking)
  node_modules/uuid

2 vulnerabilities (1 moderate, 1 high)
```

### Exploitability assessment in our code

| Advisory | Triggering API | Used in our bridge? |
|---|---|---|
| path-to-regexp ReDoS | Parameterised route patterns parsed at runtime | **No.** Bridge declares two static routes — `/status` ([bridge/server.js:153](bridge/server.js#L153)) and `/execute` ([bridge/server.js:157](bridge/server.js#L157)). Parser runs once on constants at app-init, never on attacker input. |
| uuid v3/v5/v6 buf bounds | `uuid.vX(options, buffer, offset)` with a buffer arg | **No.** Bridge calls `uuidv4()` with no args ([bridge/server.js:54](bridge/server.js#L54)). |

### Stop-gate (resolved)

Per `stage-2-prompt.md` Stage 2A step 3: "If anything Critical or High is
reported, stop and review with the human before proceeding." HIGH on
path-to-regexp triggered the gate. Stage 2 paused for human decision; the
human authorised the recommended `npm audit fix` (patch path-to-regexp,
do **not** bump uuid).

### Post-fix install + audit

```
$ cd bridge && npm audit fix
changed 1 package, and audited 71 packages in 1s
1 moderate severity vulnerability  (uuid only)

$ npm audit
# npm audit report
uuid  <14.0.0                                                              MODERATE
  Missing buffer bounds check in v3/v5/v6 when buf is provided
  https://github.com/advisories/GHSA-w5hq-g745-h8pq
  fix available via `npm audit fix --force` (breaking)
  node_modules/uuid

1 moderate severity vulnerability
```

Verified `node_modules/path-to-regexp` now at `0.1.13` (the patched version)
in `bridge/package-lock.json`. The HIGH advisory is resolved.

### Decision rationale

- **path-to-regexp — patched.** Non-breaking lockfile bump. No actual
  exploit path in the current bridge (routes are static), but patching
  removes the latent risk if a future change ever adds a parameterised
  route, and it costs us nothing.
- **uuid v9 — retained.** The advisory's triggering API
  (`uuid.vX(options, buf, offset)`) is never called by the bridge — we use
  the no-arg form `uuidv4()` at [bridge/server.js:54](bridge/server.js#L54).
  The fix is a breaking major bump (v9 → v14) which would require
  re-validating our import shape against the new package layout. No security
  benefit in our case, so we keep v9.

### Plugin folder

`plugin/` contains no `package.json` (verified). No second `npm install`
needed.

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

## Stage 2B — Bridge runtime verification

### Bind verification (live)

Bridge started in background:

```
[Bridge] WARNING: BRIDGE_TOKEN not set. Any local process can send InDesign commands.
[Bridge]   To enable auth: export BRIDGE_TOKEN="$(openssl rand -hex 32)" before starting.
[Bridge] HTTP server on http://127.0.0.1:3000
[Bridge] WebSocket server on ws://127.0.0.1:3001
[Bridge] Waiting for UXP plugin to connect...
```

Token warning is expected (mandatory-token enforcement is a deferred Stage 4
item per the safety report). No errors, no outbound network calls in the
logs.

`netstat -an | grep -E ':3000|:3001'` while running:

```
TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING
TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING
```

Both sockets bound to `127.0.0.1` only — Block 1 verified at runtime, not
just by code reading.

### Non-loopback reachability (single-machine proxy test)

Could not run the cross-device test (no second device available right now).
Closest available proxy: `curl -m 2 http://0.0.0.0:3000/status` from the
same machine — connection failed (`HTTP=000`), consistent with the wildcard
address not being bound. The proper cross-device check
(`curl http://<LAN-IP>:3000/status` from another machine) is left as a
**manual verification step for the human** before any shared-machine use.

### Endpoint smoke tests (curl from localhost)

| Request | Expected | Actual | Latency |
|---|---|---|---|
| `GET /status` | `{connected:false,queueDepth:0}` 200 | `{"connected":false,"queueDepth":0}` 200 | 10 ms |
| `POST /execute {code:"return 1+1"}` (no plugin) | 503 + plugin-not-connected error | 503 + correct message | 13 ms |
| `POST /execute {}` (missing code, no plugin) | 400 (would, with plugin connected) | 503 — plugin-not-connected check fires *before* the missing-code check | 3 ms |

`/status` and `/execute` response shapes match the bridge source. Sub-15 ms
round-trips at the HTTP layer; the in-flight protocol latency to plugin can
only be measured once a plugin is connected (Stage 2D).

#### Minor anomaly worth noting

The order of checks in `/execute`
([bridge/server.js:158-167](bridge/server.js#L158-L167)) is `pluginSocket
null → 503` first, `body has code → 400` second. So a malformed POST during
disconnected periods returns the wrong status code (503 with a
"plugin-not-connected" message instead of 400 with a "missing code"
message). Not a security issue, but a debugging-UX paper cut. **Defer:**
worth a small reorder when we touch the bridge in earnest in a later stage.

### Bridge shutdown

`taskkill //F //PID <pid>` after netstat lookup. Confirmed both ports left
LISTENING state; only TIME_WAIT entries from the completed curl client
sockets remained.

### Stage 2B status: **complete pass.** Bridge alive, bound to loopback only,
endpoints behave as designed.

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
