# STAGE 2 NOTES

Working notes that come out of the pre-Stage-2 mitigation pass
(`pre-stage-2-prompt.md`). Each section corresponds to one item in the
prompt; items here either record verification outcomes or capture work that
is deferred to a later stage.

---

## Stage 2 — One-page summary

**Branch:** `analysis/initial-pass`
**Reference tag:** `stage-1.5-complete` at `1ee2156` (post-mitigation,
pre-Stage-2A).
**Commits since tag:** **13** (12 prior + this Stage 2F wrap-up).

### Block items (pre-Stage-2)

| # | Item | Commit | Status |
|---|---|---|---|
| 1 | Bridge bind to `127.0.0.1` only | (no commit — already correct) | **pass** — verified by code reading and at runtime in Stage 2B (netstat) |
| 2 | Disable `execute_indesign_code` in all registration sites | `03800b1` | **pass** — router branch commented, tool definition removed, help list pruned, handler body returns disabled-error stub. Concern 3 grep verified no active path remains |
| 3 | Path traversal protection on every user-supplied path | `0140e21` | **pass** — `validatePath()` in `src/utils/pathValidator.js` applied to 11 handler entry points across 5 files |
| 4 | `npm audit` Critical/High gate | `b513f02` (resolution) | **gate triggered then resolved** — HIGH on `path-to-regexp <0.1.13`; human authorised non-breaking `npm audit fix`; only the moderate uuid v9 advisory remains, intentionally retained because the buggy API path is unreachable from our call site |

### Concern items (pre-Stage-2)

| # | Item | Commit | Status |
|---|---|---|---|
| 1 | Pin Node engine `>=18.0.0` in `bridge/package.json` | `bc53ef6` | done |
| 2 | Document plugin manifest permissions reasoning | `19886c9` | done — `plugin/README.md` covers every declared/declined permission and flags the still-open `network.domains: "all"` tightening |
| 3 | Verify `executeScript` fully disabled | (folded into Block 2 record above) | done — grep audit recorded in this file |

### Stage 2A — Install + audit

- `npm install --ignore-scripts` in `bridge/`: 70 packages, no postinstall scripts ran.
- `node v24.11.1`, `npm 11.12.0` (recorded for reproducibility).
- Initial audit: 1 HIGH (`path-to-regexp` ReDoS), 1 moderate (`uuid` buf bounds). HIGH triggered the Stage 2A.3 stop-gate.
- **Decision:** patch path-to-regexp via `npm audit fix` (non-breaking lockfile bump); do **not** bump uuid v9 → v14 (breaking, no actual security benefit because the buggy API path is never called).
- Post-fix audit: only the moderate uuid advisory remains, by design.
- `plugin/` has no `package.json`, so no second install needed.

### Stage 2B — Bridge runtime

- Bridge binds `127.0.0.1` on both `:3000` (HTTP) and `:3001` (WebSocket); verified live via `netstat`.
- Endpoint smoke tests: `GET /status` returns `{connected:false,queueDepth:0}` (10 ms); `POST /execute` with no plugin returns 503 + plugin-not-connected (13 ms).
- `0.0.0.0:3000` connect from same machine fails as expected (`HTTP=000`).
- **Cross-device reachability test still owed by human** before any shared-machine deployment (couldn't run in this session — no second device).
- Minor anomaly noted: `/execute` checks plugin presence *before* body validity, so a malformed POST during disconnection returns 503 with a misleading "plugin-not-connected" message rather than 400. Debugging-UX paper cut, not a security issue.

### Stage 2C — Plugin load

- InDesign **21.3 x64** = InDesign 2026 (well above the 2024+ requirement).
- No permission prompts displayed during Add Plugin / Load — this means there is no positive screenshot evidence of consent. Manifest's `network.domains: "all"` is unchanged from the safety review and remains a Stage-4 follow-up.
- Panel renders cleanly, status `<p>` shows `Connected to bridge ✓`, bridge log shows `[Bridge] Plugin connected`, `/status` returns `connected:true`.
- Plugin DevTools console clean except for an unplanned-but-expected stack of `WebSocket error: v` lines that turned out to be the auto-reconnect loop running between Stage 2B's bridge shutdown and 2C's restart — accidental positive evidence for Stage 2E Test 1.

### Stage 2D — Round-trip latency

Three escalating curls, end-to-end (caller → HTTP → bridge → WS → plugin → `new Function('app', code)` → InDesign DOM → bridge → caller):

| # | Body | Total |
|---|---|---|
| 1 | `1 + 1` | 40 ms |
| 2 | `app.documents.length` | 34 ms |
| 3 | `{docs, version, name}` | 30 ms |

Above the prompt's "single-digit ms" expectation. Trend (40 → 34 → 30 ms) consistent with JIT warmup. UUIDs preserved end-to-end. `app.version="21.3.0.60"` matches the InDesign 2026 build seen in Help → About.

For our 12-tile render flow, ~30 ms × dozens of operations ≈ low single-second total — acceptable. If latency climbs into hundreds of ms per call later, the natural fix is to batch a whole render into one `/execute` script.

### Stage 2E — Lifecycle (key findings, one line each)

- **Test 1** — bridge restart while plugin connected → plugin auto-reconnects within ≤3 s of new bridge accepting; panel flips Disconnected → Connected cleanly.
- **Test 2** — plugin reload via UXP DT → graceful WS close logs `[Bridge] Plugin disconnected`, reload connects fresh instance.
- **Test 3** — InDesign force-quit mid-flight → **race finding**: the bridge's 30 s timeout wins against the WS-close handler on Windows force-quit, so the caller sees `"Execution timed out after 30s"` rather than `"Plugin disconnected"`. Both paths exist; the timer just fires first.
- **Test 4** — bridge kill mid-flight → curl errors cleanly in ~0.7 s after kill (`HTTP=000`); plugin auto-reconnects when bridge returns; **orphan-result note**: in-flight setTimeout results have nowhere to go after a bridge restart, so callers must resubmit, not assume the plugin remembered.
- **Test 5** — 5 concurrent requests → UUID correlation perfect, all 5 responses match their senders; bridge log shows strict `Sending → From plugin → Sending → …` (no interleaving) confirming the serial queue's exclusivity.
- **Test 6** — 2 concurrent render-shaped sequences (multi-step + async) → A.end (781777) precedes B.start (781780) by 3 ms; multi-step state didn't cross-contaminate; serial queue holds for realistic workloads.
- **Test 7** — disconnect UX → status text static at `"Disconnected — retrying in 3s"` for full 20 s observation; no countdown, no spinner, no clickable elements. The plugin's UI is a debug aid, not a user-facing surface.

### Deferred to Stage 4 (must not be lost)

| Item | Source |
|---|---|
| Mandatory `BRIDGE_TOKEN` enforcement (currently warns and continues; should `process.exit(1)` if unset) | safety-report.md §10 |
| Tighten `plugin/manifest.json` `network.domains` from `"all"` to `["ws://127.0.0.1:3001", "ws://localhost:3001"]` | safety-report.md §1 |
| Reorder `/execute` check sequence in the bridge so missing `code` returns 400 even when plugin is also disconnected | Stage 2B paper cut |
| Cross-device LAN-IP reachability test (`curl http://<LAN-IP>:3000/status` from another machine should fail) | Stage 2B owed |
| Force-quit timeout disambiguation strategy in dashboard — on a 30 s timeout, dashboard should poll `/status` to distinguish "plugin slow" from "plugin died" | Test 3 finding |
| Caller-side resubmit pattern for orphan results — never rely on the plugin to "remember" mid-flight requests across bridge restart | Test 4 finding |
| Concurrent-request UI feedback — surface "you're #N in queue" / per-render ETA so the dashboard doesn't lie about latency for second-and-beyond submissions | Tests 5/6 finding |
| User-facing disconnect UX — dashboard must own its own connection-health indicator with countdown / liveness / retry affordance, since the plugin's panel doesn't | Test 7 finding |
| (Optional) Replace the eval-string protocol with a fixed dispatch table of named operations and drop `allowCodeGenerationFromStrings` from the manifest | safety-report.md §1 long-term hardening |

---

## Stage 2 complete

The substrate is **verified**. End-to-end requests round-trip from a CLI caller through the bridge, the plugin's WebSocket, `new Function('app', code)`, the InDesign DOM, and back. The seven lifecycle scenarios are all characterised, with two real findings (Test 3 race, Test 4 orphan-result) recorded for Stage 4 dashboard design.

**Recording / screenshots — deferred.** The prompt offered a 60 s screen recording or sequential screenshots as evidence. We chose to skip both: this notes file is more thorough than a recording would be (every test has timestamps, log diffs, and per-axis interpretation), and the screenshots already pasted in the conversation log for Stage 2C (panel showing `Connected to bridge ✓`, plus InDesign with the panel docked) and Stage 2D (DevTools `[Plugin] Received:` confirmations) and Stage 2E Test 4 (DevTools showing the WS-error → reconnect cycle) cover the same three views the recording would have shown. If a recording is later required for compliance or onboarding, it can be produced from the running substrate without re-doing any test work.

**Substrate teardown.** Bridge stopped (`taskkill /F`), plugin left in its `Disconnected — retrying in 3s` state — that is, the WebSocket dies as soon as the bridge does, the plugin enters its 3 s reconnect cycle, and any further activity is benign console-error noise until either the bridge is restarted or the panel is unloaded from UXP DT (a manual GUI step). The repo is ready for Stage 3.

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

## Stage 2C — Plugin load (in InDesign + UXP DT)

### Environment

- **InDesign** Adobe InDesign **21.3 x64** — this is InDesign 2026 (version
  map: v18=2023, v19=2024, v20=2025, v21=2026). Confirmed via Help → About
  InDesign (screenshot in conversation log).
- **UXP Developer Tool** present and used to add the plugin from
  `e:\TAI\indesign-uxp-server\plugin\`.

### Permission prompts (Step 4)

**No prompts were displayed** when the plugin was added/loaded. The
manifest's only `requiredPermissions` entries are
`network.domains: "all"` and `allowCodeGenerationFromStrings: true` —
neither triggers an end-user consent dialog in UXP DT's "Add Plugin"
workflow on this version of InDesign.

This is fine for the *behaviour* (the permissions are still granted via the
manifest), but it means there is no positive screenshot evidence of consent.
The deferred follow-up is to tighten `network.domains` to a localhost
allow-list (safety-report.md §1) before any shared-machine deployment.

### Plugin panel (Steps 5, 6)

- Loaded via UXP DT → "Add Plugin" → folder pointer → **Load**.
- Panel appears as **Window → Plug-Ins → Bridge Panel**, label "Bridge
  Panel" (matches manifest `entrypoints[0].label.default`).
- Panel renders cleanly. Status `<p>` element shows: **`Connected to
  bridge ✓`**.
- Screenshot evidence in conversation log (Stage 2C reply).

### Plugin DevTools console

Order of log lines (top to bottom):

```
[Plugin] DOM OK — open docs: 0                  (index.js:74)
[Plugin] new Function() OK: 2                   (index.js:81)
[Plugin] WebSocket error: v        (×19)        (index.js:59)
[Plugin] Connected to bridge                    (index.js:36)
```

**Interpretation.** The 19 stacked WebSocket errors are not bugs — they
are the plugin's auto-reconnect loop ([plugin/index.js:62-65](plugin/index.js#L62-L65))
exercising itself while the bridge was down between Stage 2B's clean
shutdown and the Stage 2C restart. Each failed connect at 3 s interval
fires `ws.onerror` ([plugin/index.js:59](plugin/index.js#L59)) → 19 × 3 s
≈ ~57 s of bridge-down time, which matches the gap between Stage 2B and
Stage 2C in real time. The final `Connected to bridge` line is the moment
the new bridge came up and the next reconnect attempt succeeded.

This is also unplanned positive evidence for **Stage 2E Test 1
(bridge-restart auto-reconnect)** — the plugin recovers without
intervention when the bridge returns.

No other red errors or warnings.

### Bridge-side evidence

`/tmp/bridge.log` (running bridge) recorded `[Bridge] Plugin connected`
the moment the plugin's auto-reconnect cycle succeeded.

`curl http://127.0.0.1:3000/status` while panel was attached:

```
{"connected":true,"queueDepth":0}
HTTP=200 TIME=0.028s
```

### Stage 2C status: **complete pass.**

The substrate is alive end-to-end on the GUI side. Connection is
established, panel UI is correct, plugin DevTools console contains only
expected output, and the auto-reconnect loop is verified to work in
practice as a side-effect.

---

## Stage 2D — No-op round trip

Goal: prove the full chain works by sending real requests through it. Three
escalating curls, each verified at every hop (caller → bridge log → plugin
DevTools console → bridge log → caller).

### Pre-flight

`GET /status` before the test:

```
{"connected":true,"queueDepth":0}
```

`/tmp/bridge.log` was at 6 lines (startup banner + Plugin connected event).

### Test #1 — bare round trip + primitive serialization

```
$ curl -s -X POST http://127.0.0.1:3000/execute \
       -H 'Content-Type: application/json' \
       -d '{"code":"return 1 + 1;"}'
{"result":2}
HTTP=200 TIME=0.039799s
```

Bridge log:

```
[Bridge] Sending execute: 66873768-812c-43b0-a102-ef62a50564cf return 1 + 1;
[Bridge] From plugin: {"type":"result","id":"66873768-812c-43b0-a102-ef62a50564cf","result":2}
```

Plugin DevTools (confirmed by human):

```
[Plugin] Received: {"type":"execute","id":"66873768-812c-43b0-a102-ef62a50564cf","code":"return 1 + 1;"}
```

### Test #2 — DOM access + object serialization

```
$ curl -s -X POST http://127.0.0.1:3000/execute \
       -H 'Content-Type: application/json' \
       -d '{"code":"return { docs: app.documents.length };"}'
{"result":{"docs":0}}
HTTP=200 TIME=0.033894s
```

Bridge log:

```
[Bridge] Sending execute: a7c85615-93f9-4c36-b1dc-62d6bff3a10a return { docs: app.documents.length };
[Bridge] From plugin: {"type":"result","id":"a7c85615-93f9-4c36-b1dc-62d6bff3a10a","result":{"docs":0}}
```

Plugin DevTools (confirmed by human): matching `[Plugin] Received: …` line
with id `a7c85615-…`.

### Test #3 — multi-field DOM serialization

```
$ curl -s -X POST http://127.0.0.1:3000/execute \
       -H 'Content-Type: application/json' \
       -d '{"code":"return { docs: app.documents.length, version: app.version, name: app.name };"}'
{"result":{"docs":0,"version":"21.3.0.60","name":"Adobe InDesign"}}
HTTP=200 TIME=0.029998s
```

Bridge log:

```
[Bridge] Sending execute: 19975fea-d237-4f0d-abf4-1d8c1ee498e5 return { docs: app.documents.length, version: app.version, name: app.name };
[Bridge] From plugin: {"type":"result","id":"19975fea-d237-4f0d-abf4-1d8c1ee498e5","result":{"docs":0,"version":"21.3.0.60","name":"Adobe InDesign"}}
```

Plugin DevTools (confirmed by human): matching `[Plugin] Received: …` line
with id `19975fea-…`.

`app.version = 21.3.0.60` matches the InDesign 2026 build seen in Help →
About during Stage 2C — confirms we are talking to the same instance.

### Latency profile

| # | Body | Total |
|---|---|---|
| 1 | `1 + 1` (cold) | 40 ms |
| 2 | `app.documents.length` | 34 ms |
| 3 | multi-field DOM read (warm) | 30 ms |

Above the prompt's "single-digit ms" expectation. Likely contributors:
Node + Express + WebSocket overhead, `new Function('app', code)` JIT on
each call, Windows pipe + curl process startup. The trend (40 → 34 → 30)
is consistent with JIT/cache warmup.

For our 12-tile render flow, ~30 ms × dozens of operations ≈ low
single-second total — acceptable. If we see it climb into hundreds of ms
per call later, the natural fix is to batch a whole render into one
`/execute` script (one HTTP round-trip, one `new Function` compile, many
DOM operations inside).

### ID correlation

All three requests round-tripped with their UUIDs preserved end-to-end
(caller → bridge → plugin → bridge → caller). The bridge's
`pending` map keyed by `uuid` is doing its job. Concurrent-request
correlation will be exercised explicitly in Stage 2E Test 5.

### Stage 2D status: **complete pass.** Full chain proven end-to-end.

---

## Stage 2E — Connection lifecycle tests

### Test 1 — Bridge restart while plugin connected

**Goal:** verify the plugin's auto-reconnect loop ([plugin/index.js:62-65](plugin/index.js#L62-L65))
recovers cleanly when the bridge restarts.

**Method.** Shell-side: `taskkill /F` the bridge process, sleep 10 s, `node
server.js` again. Plugin-side (human-observed): watch panel status text and
DevTools console.

**Timeline (server clock, retry run):**

| Time | Event |
|---|---|
| 20:28:09.491 | bridge killed (`taskkill /F` on PID 42136) |
| 20:28:09.491 → ~20:28:21 | bridge down; `GET /status` returns `HTTP=000` |
| ~20:28:21.5 | bridge restart issued |
| ~20:28:22 | bridge logs `Waiting for UXP plugin to connect...` then `[Bridge] Plugin connected` |
| ~20:28:27 | `GET /status` returns `{"connected":true,"queueDepth":0}` HTTP 200 |

**Plugin-side observations (confirmed by human):**

1. Panel status text flipped to **"Disconnected — retrying in 3s"** within
   ~1 s of T-0.
2. Panel status text flipped back to **"Connected to bridge ✓"** when the
   new bridge accepted the next reconnect attempt.
3. The earlier inadvertent observation in 2C (19 stacked
   `[Plugin] WebSocket error: v` lines followed by `[Plugin] Connected to
   bridge`) is the same mechanism playing out over a longer downtime.

**Bridge log delta (clean shutdown is silent — `taskkill /F` is a hard
kill, no `ws.on('close')` handler runs):**

```
[Bridge] WARNING: BRIDGE_TOKEN not set. ...
[Bridge] HTTP server on http://127.0.0.1:3000
[Bridge] WebSocket server on ws://127.0.0.1:3001
[Bridge] Waiting for UXP plugin to connect...
[Bridge] Plugin connected
```

The absence of a `[Bridge] Plugin disconnected` line on the kill side is
worth noting: a hard process kill prevents any clean-shutdown logging.
Soft shutdown (Ctrl+C → SIGINT) would let the WS close handler fire. Not a
problem for our use case but informs the lifecycle test interpretation.

**Status: pass.** Plugin recovers without intervention; downtime visible
only via panel status text and DevTools WS-error log entries. No data loss
because no requests were in flight (Test 4 covers in-flight kill).

### Test 2 — Plugin reload while bridge running

**Goal:** verify graceful WebSocket close from the plugin side, and that
the reloaded plugin instance reconnects cleanly.

**Method.** Human clicked **Reload** on the Bridge plugin in UXP Developer
Tool while the bridge was running. Bridge log was the only instrumented
observation point on the shell side.

**Bridge log delta:**

```
[Bridge] Plugin connected         (from Test 1's reconnect)
[Bridge] Plugin disconnected      ← UXP DT cleanly closed the WS
[Bridge] Plugin connected         ← reloaded plugin's panel.show fired
```

**Plugin-side observation (confirmed by human):** "panel refreshed with
connected message" — i.e., status `<p>` reset (briefly `Initializing...`
per [plugin/index.html:5](plugin/index.html#L5), then `Connected to
bridge ✓`).

**Why this matters vs Test 1.** Test 1 killed the *bridge* with
`taskkill /F`, so the bridge process died before any logging code ran —
no disconnect line appeared on the bridge side. Test 2 cycles the
*plugin* via UXP DT's Reload, which is a graceful WebView teardown:
the plugin's WebSocket fires `onclose` cleanly, the bridge receives the
close event, runs `ws.on('close')`
([bridge/server.js:130-144](bridge/server.js#L130-L144)), logs
**`[Bridge] Plugin disconnected`**, sets `pluginSocket = null`, and
rejects any pending entries.

`/status` after reload: `{"connected":true,"queueDepth":0}` HTTP 200.

**Status: pass.** Graceful disconnect + reconnect path is exercised and
matches the bridge code's intent.

### Test 3 — InDesign force-quit during in-flight request

**Goal:** verify the bridge's behaviour when the plugin disappears
mid-flight (between `Sending execute` and `From plugin`). Code path of
interest: [bridge/server.js:130-144](bridge/server.js#L130-L144), the
`ws.on('close')` handler that should reject pending entries with
"Plugin disconnected".

**Method.** Two attempts:

1. *First attempt* — 20 s setTimeout in the executed code, no force-quit
   happened in time. Curl returned `{"result":"late"}` cleanly at 20.09 s.
   Useful side observation: the bridge correctly held a 20 s request
   without hitting its 30 s safety timeout.
2. *Second attempt* — 60 s setTimeout in the executed code, human pre-
   staged Task Manager and force-quit InDesign during the wait. This is
   the run we record below.

**Result of attempt 2 (the real one):**

| | |
|---|---|
| Curl response | `{"error":"Execution timed out after 30s"}` HTTP 500 |
| Curl elapsed | 30.020 s |
| Bridge log lines added | `[Bridge] Sending execute: 47383037-…`<br>`[Bridge] Plugin disconnected` |
| `/status` after | `{"connected":false,"queueDepth":0}` HTTP 200 |
| `tasklist \| grep -i indesign` after | empty (force-quit succeeded) |

**Key finding — race between two cleanup paths.**

The bridge has *two* mechanisms that should reject a pending HTTP caller:

1. **30 s timer** at [bridge/server.js:56-61](bridge/server.js#L56-L61) —
   rejects with `"Execution timed out after 30s"`.
2. **`ws.on('close')` handler** at [bridge/server.js:130-144](bridge/server.js#L130-L144) —
   rejects with `"Plugin disconnected"` and clears any pending entry.

On a Windows Task Manager force-quit, the OS doesn't always send a clean
TCP FIN — the bridge's WebSocket can wait many seconds before its
`onclose` event fires. The 30 s timer raced the close event and won, so
the caller saw the timeout error rather than the disconnect error.
Eventually the close event did surface (visible in the bridge log) and
`/status` correctly reports `connected:false`, but by then curl had
already returned.

**Implications for Stage 4 dashboard design.** The user-facing error on
hard plugin death is `"Execution timed out after 30s"`, not
`"Plugin disconnected"`. Two consequences:

- The dashboard cannot distinguish "InDesign is genuinely slow" from
  "InDesign died" by error string alone after a 30 s timeout.
- Recommended pattern: on a 30 s timeout, the caller should also poll
  `GET /status`. If `connected:false`, surface a "plugin died" message;
  otherwise surface a "still working" / "operation slow" message and let
  the user retry.

**Status: partial pass.** The in-flight rejection path is correct and
*runs* (we can see it in the bridge log), but on Windows force-quit it
loses a race to the safety timeout. The caller still gets a clean
HTTP 500 within bounded time and the bridge state recovers. Behaviour
is documented; no code change required for Stage 2.

After test: human re-launched InDesign and reloaded the plugin via UXP
Developer Tool (UXP DT side-loads don't survive InDesign restarts —
`Add Plugin` persists, but `Load` does not). `/status` returned
`{"connected":true,"queueDepth":0}` once the panel reopened.

### Test 4 — Bridge killed during in-flight request

**Goal:** verify the plugin's WebSocket-close detection and the in-flight
caller's failure mode when the *bridge* dies mid-flight (inverse of
Test 3, where the plugin died).

**Method.** Shell-side: fire a 60-second `setTimeout` request, sleep 3
seconds (so the plugin has received it and is awaiting), kill the bridge
with `taskkill /F`, hold down 10 seconds, restart. Plugin-side:
human-observed panel + DevTools.

**Timeline:**

| Time | Event |
|---|---|
| 20:50:10.681 | curl fired with 60 s setTimeout body |
| 20:50:13.847 | bridge killed (`taskkill /F` on PID 55124) |
| 20:50:15.817 | curl errored out — `HTTP=000`, `TIME=3.92 s` |
| 20:50:13.847 → ~20:50:24 | bridge down (~10 s observation window) |
| ~20:50:24 | bridge restarted |
| ~20:50:29 | bridge logs `[Bridge] Plugin connected` |

curl noticed the dead bridge **~0.7 s after the kill** (3.92 − 3.20).
Clean connection-reset response, no hang.

**Bridge log delta:**

```
[Bridge] Sending execute: 2d8b9b49-60b5-4576-9bdc-00cafa52d75a await new Promise(r => setTimeout(r, 60000)); return "late";
(bridge died here — no further log lines from old session)
[Bridge] WARNING: BRIDGE_TOKEN not set. ...
[Bridge] HTTP server on http://127.0.0.1:3000
[Bridge] WebSocket server on ws://127.0.0.1:3001
[Bridge] Waiting for UXP plugin to connect...
[Bridge] Plugin connected
```

**Plugin DevTools (confirmed by human screenshot):**

```
[Plugin] DOM OK — open docs: 0
[Plugin] new Function() OK: 2
[Plugin] Connected to bridge
[Plugin] Received: {"type":"execute","id":"2d8b9b49-...","code":"await new Promise(r => setTimeout(r, 60000)); return \"late\";"}
[Plugin] WebSocket error: v {Symbol(type): "error", Symbol(target): c, ...}    (×7)
[Plugin] Connected to bridge
```

The matching request ID in the plugin's "Received" line confirms the
plugin received and started processing the request before the bridge
died — i.e., the test really did exercise the in-flight code path, not
just the precondition. Seven WS error lines × 3 s reconnect interval ≈
21 s of cycle time (slightly longer than the 13 s downtime because the
interval doesn't align with the restart instant).

**Plugin-side observations (confirmed by human):**

- Panel flipped to `Disconnected — retrying in 3s` immediately on bridge
  kill.
- Panel returned to `Connected to bridge ✓` once reconnect succeeded.

**Orphan-result note.** The plugin's executed code (the 60 s setTimeout)
was still running inside InDesign at the moment the bridge died. When
the setTimeout eventually resolves (60 s later), the plugin tries to
`ws.send(result)` on the now-closed WebSocket — that throws or silently
drops, depending on the WS library state. The result is not delivered
to the new bridge connection (the `ws` reference in
`handleExecute`'s closure is the *old* dead one). Implication for
Stage 4: the dashboard must not rely on the plugin "remembering"
in-flight requests across a bridge restart; callers should resubmit
after a `HTTP=000` / connection-reset response.

**Status: pass.** Bridge-side code path correct (curl fails fast),
plugin-side recovery correct (auto-reconnect lands), no hang on either
side, no zombie state. The only nuance is the orphan-result behaviour,
documented above.

### Test 5 — 5 concurrent requests

**Goal:** verify UUID-based request correlation under load and confirm
the serial queue at the bridge level.

**Method.** Five curls fired with bash `&` (parallel forks), each sending
distinct code:

```
return { caller: <i>, n: <i> * <i>, ts: Date.now() };   for i in 1..5
```

Each response should carry `caller:i` matching its request, with `n`
equal to `i*i`. Plugin-side `Date.now()` timestamps reveal execution
order at the plugin.

**Responses (all HTTP 200):**

| caller | result | curl TIME |
|---|---|---|
| 1 | `{caller:1, n:1, ts:1777607599414}` | 43 ms |
| 2 | `{caller:2, n:4, ts:1777607599422}` | 24 ms |
| 3 | `{caller:3, n:9, ts:1777607599433}` | 9 ms |
| 4 | `{caller:4, n:16, ts:1777607599459}` | 9 ms |
| 5 | `{caller:5, n:25, ts:1777607599478}` | 6 ms |

All five matched their own request — no cross-contamination.

**Bridge log delta** (UUIDs from response IDs match those in the
`Sending execute:` lines, omitted here for brevity):

```
Sending execute: 3942...   return { caller: 1, ...
From plugin:    3942...    "caller":1, "n":1
Sending execute: 7c50...   return { caller: 2, ...
From plugin:    7c50...    "caller":2, "n":4
Sending execute: 1829...   return { caller: 3, ...
From plugin:    1829...    "caller":3, "n":9
Sending execute: fdd3...   return { caller: 4, ...
From plugin:    fdd3...    "caller":4, "n":16
Sending execute: 73ff...   return { caller: 5, ...
From plugin:    73ff...    "caller":5, "n":25
```

Strict `Sending → From plugin → Sending …` pattern — no two `Sending`s
appear back-to-back, confirming the bridge's serial queue
([bridge/server.js:39-88](bridge/server.js#L39-L88)) is exclusive.

**Plugin-side execution span (from `Date.now()` `ts` values):**

```
414 → 422 → 433 → 459 → 478   (ms within minute)
+8     +11    +26    +19      Δ between consecutive executions
```

Total plugin-side span: 64 ms for 5 requests, ~13 ms average
per-request including round-trip overhead.

**Total wall-clock burst:** ~435 ms (T-0 to last curl finish). The 6×
gap between plugin span and total is curl process spawn time + sequential
bash forks, not bridge or plugin slowness.

**Curl TIME pattern (decreasing) is an artifact, not a finding.** Bash
`&` staggers curl spawn by a few ms; by the time curl #5 hits the
bridge, callers 1-4 have already cleared. Earlier curls eat the queue
serialization tax; later curls walk into an idle bridge.

**`queueDepth` sampled 50 ms in returned 0.** That field counts
*waiting* items, not the head being processed, so it only spikes
during the brief window callers 2-5 are waiting on caller 1. Our
sample missed that window.

**Status: pass.** UUID correlation, serial queue exclusivity, and
no-cross-contamination all confirmed.

### Test 6 — Concurrent render-shaped sequences

**Goal:** verify the serial queue + correlation guarantee using
multi-step async sequences resembling actual render workloads (multiple
DOM reads + `setTimeout` awaits inside one `/execute` script), rather
than trivial `1 + 1`-shaped tests.

**Method.** Two concurrent calls (caller A, caller B), each running:

```js
const t0 = Date.now();
const seen = [];
seen.push(["start", Date.now() - t0]);
seen.push(["docs", app.documents.length, Date.now() - t0]);
await new Promise(r => setTimeout(r, 50));
seen.push(["after-50ms", Date.now() - t0]);
seen.push(["version", app.version, Date.now() - t0]);
await new Promise(r => setTimeout(r, 50));
seen.push(["end", Date.now() - t0]);
return { caller: "A"|"B", t0Ts: t0, totalMs: Date.now() - t0, steps: seen };
```

JSON request bodies built via Node (`JSON.stringify`) to avoid the shell
escaping landmines that bricked the first attempt.

**Results (both HTTP 200):**

```
A: {caller:"A", t0Ts:1777607781623, totalMs:154,
    steps:[["start",0],["docs",0,14],["after-50ms",77],["version","21.3.0.60",91],["end",154]]}
B: {caller:"B", t0Ts:1777607781780, totalMs:120,
    steps:[["start",0],["docs",0,2],["after-50ms",58],["version","21.3.0.60",59],["end",120]]}
```

**Key evidence — A and B's plugin-side time spans do not overlap:**

```
A:    t0=781623 ─────────── end=781777
                               (gap: 3 ms)
B:                          t0=781780 ──────── end=781900
```

`A.end` (781777) precedes `B.start` (781780) by 3 ms. The bridge held
B's request in the queue until A returned, then dispatched B. This is
the strongest available evidence that the serial-queue invariant
(`bridge/server.js:34-95`) protects against concurrent UXP DOM
mutation.

**Multi-step state did not cross-contaminate.** A's `steps` array and
B's `steps` array each contain only their own measurements; no entries
from the other render leaked in. Each `new Function('app', code)` call
runs in its own closure scope at the plugin.

**Curl timings:**

| | curl `TIME` | Plugin `totalMs` | Overhead/wait |
|---|---|---|---|
| A | 161 ms | 154 ms | 7 ms (HTTP+WS round trip) |
| B | 271 ms | 120 ms | 151 ms (mostly waiting on A) |

B's 151 ms overhead is roughly the time it spent waiting in the bridge
queue while A executed. The math (`7 + 154 + ~110 ≈ 271`) is consistent.

**Wall-clock burst total:** ~414 ms for two ~140 ms renders sequenced
— exactly what serial queueing predicts (sum of per-render times +
bursting overhead).

**Bridge log shows the same strict pattern as Test 5:**

```
Sending execute: 154b...   (caller A)
From plugin:    154b...    "caller":"A"
Sending execute: 2ea1...   (caller B)
From plugin:    2ea1...    "caller":"B"
```

**Implication for Stage 4 dashboard.** Concurrent render submissions
are safe — the bridge serializes them — but each caller's wall-clock
latency stretches with how many other renders are queued ahead. The
dashboard should probably surface "you're #N in queue" feedback, or at
least not lie about latency for the second-and-beyond submission.

**Status: pass.** Serial queue exclusivity holds for realistic
multi-step workloads, no cross-contamination of multi-step state, and
queue-wait latency behaves predictably.

---

### First attempt failure note (informational)

The first attempt at Test 6 used inline shell-quoted JSON bodies that
shell-mangled into invalid JSON. The bridge correctly rejected both
with HTTP 400 + a body-parser SyntaxError, did not crash, kept the
queue at 0, and the plugin was never reached. Bonus evidence: the
bridge handles malformed input cleanly.

### Test 7 — Disconnect UX

**Goal:** describe what an end user actually sees in the panel when the
bridge is down. Stage 4 dashboard design depends on knowing whether the
current plugin UI gives users enough information to act, or whether we
need to add elements.

**Method.** Killed bridge, held down for 20 s with no further action,
asked human to observe and describe. Bridge dead at 20:59:59.941 with
`taskkill /F`; restarted at ~21:00:23 once the human had described.

**Human observation (verbatim):** "once disconnected, wording stays in
'Disconnected — retrying in 3s', no clickable elements, no spinners,
no decrease in timer, just that, no hang or something."

**Mapped to plugin code:**

- Status text: set once in `ws.onclose`
  ([plugin/index.js:62-65](plugin/index.js#L62-L65)) to the literal
  string `"Disconnected — retrying in 3s"`. Never updated until the
  next reconnect attempt resolves (either `onopen` → "Connected to
  bridge ✓" or `onerror` → "Bridge connection error").
- The "3s" in the message is **hardcoded**, not bound to the actual
  countdown. The reconnect timer fires every 3 s, but the user has no
  visibility into when the next attempt will happen.
- The panel has zero interactive controls
  ([plugin/index.html](plugin/index.html) is just a single `<p>`).
  Nothing to click means nothing can hang on a dead connection — that
  property is structural, not earned.

**Status: pass for "doesn't break".** UX, however, is **threadbare**
and inadequate for non-technical users:

- A static "retrying in 3s" message can't distinguish "plugin is still
  trying" from "plugin has given up" or "plugin froze". The user has
  no liveness indicator.
- No manual reconnect / "try again" affordance. If a user wanted to
  force a reconnect (e.g. they just relaunched the bridge themselves
  and don't want to wait up to 3 s), they can't.
- No diagnostic information surfaced (last error, retry count, time
  since last successful connection). DevTools has it; the panel
  doesn't.
- No visual change beyond the text — no color shift, no spinner, no
  iconography.

**Implications for Stage 4 dashboard.** The dashboard sits *between*
the user and this plugin/bridge stack. Treat the plugin's panel as a
debug aid for developers, not as the user-facing surface. The
dashboard must:

1. Surface its *own* connection-health indicator (poll
   `GET /status` periodically; show a clear connected/disconnected
   state with an unambiguous timestamp).
2. Show queue depth + ETA for in-flight renders, not rely on the
   plugin to do this.
3. Provide a "retry" affordance for failed renders that includes a
   bridge health check rather than just resubmitting blindly.

**Status: pass.** Behaviour is correct and consistent with the code;
the UX gap is real but expected — Stage 2's job was to verify the
substrate, not to ship a UI.

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
