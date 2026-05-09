# Stage 2 — Progress Report

**Branch:** `analysis/initial-pass`
**As of:** commit `f5829f5` (last autonomous commit)
**Reference tag:** `stage-1.5-complete` at `1ee2156` (post-mitigation, pre-Stage-2A)

## Status

Stage 2A (dependency install + audit) and Stage 2B (bridge runtime
verification) ran end-to-end on this machine without intervention. **Stage
2C–2F (plugin load, round-trip, lifecycle, screen recording) are paused at
the GUI boundary** and require InDesign 2024+ + UXP Developer Tool, which
this shell can't drive. A precise checklist for those steps was handed off
in the conversation; an abbreviated copy is at the bottom of this file.

The substrate is alive: bridge installs cleanly, runs cleanly, binds
loopback-only on both ports, and serves its endpoints with the expected
shapes. We have no reason to believe the GUI-side wiring will fail, but it
hasn't been proven yet.

## What ran

### Stage 2A — Install & audit

| Step | Result |
|---|---|
| Pre-flight grep for pre/post-install hooks in `bridge/package.json` | None — confirmed |
| `node --version`, `npm --version` | `v24.11.1`, `11.12.0` |
| `cd bridge && npm install --ignore-scripts` | 70 packages, no scripts ran |
| Initial `npm audit` | 1 HIGH (`path-to-regexp` ReDoS), 1 moderate (`uuid` buf bounds) — **triggered the Stage 2A.3 stop-gate** |
| Human decision | Apply non-breaking `npm audit fix`, do not bump uuid |
| `npm audit fix` | `path-to-regexp` → 0.1.13, lockfile-only change |
| Post-fix `npm audit` | HIGH cleared; moderate uuid v9 remains, intentionally retained |
| `plugin/` install | Skipped — folder has no `package.json` |

**Decision rationale recorded in [STAGE-2-NOTES.md](STAGE-2-NOTES.md)
"Block 4" section:**

- *path-to-regexp:* patched (non-breaking, removes latent ReDoS risk if
  parameterized routes are ever added; bridge's current routes `/status`
  and `/execute` are static, so the bug isn't reachable today).
- *uuid v9:* retained — the buggy API path
  `uuid.vX(opts, buf, offset)` is never called (we use `uuidv4()` no-arg at
  [bridge/server.js:54](bridge/server.js#L54)). The fix would be a breaking
  major bump to v14 with no security benefit in our case.

### Stage 2B — Bridge runtime

Bridge started with `node server.js`. Logs:

```
[Bridge] WARNING: BRIDGE_TOKEN not set. ...
[Bridge] HTTP server on http://127.0.0.1:3000
[Bridge] WebSocket server on ws://127.0.0.1:3001
[Bridge] Waiting for UXP plugin to connect...
```

`netstat -an | grep -E ':3000|:3001'` while running:

```
TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING
TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING
```

Both listeners bound to `127.0.0.1` only — Block 1 verified at runtime, not
just by reading source.

#### Endpoint smoke tests (curl, localhost)

| Request | Expected | Observed | Latency |
|---|---|---|---|
| `GET /status` | `{connected:false,queueDepth:0}` 200 | matches | 10 ms |
| `POST /execute {code:"return 1+1"}` (no plugin) | 503 + plugin-not-connected | matches | 13 ms |
| `POST /execute {}` (no body, no plugin) | 400 (would, with plugin connected) | 503 — plugin-not-connected check fires before missing-code check | 3 ms |
| `GET http://0.0.0.0:3000/status` (single-machine non-loopback proxy) | connection failure | `HTTP=000`, fails | n/a |

Bridge stopped via `taskkill //F //PID …`; ports left LISTENING state, only
TIME_WAIT entries from completed curl client sockets remained.

## Notable findings

1. **`/execute` check ordering** ([bridge/server.js:158-167](bridge/server.js#L158-L167)) —
   plugin-not-connected check fires before body validation, so a malformed
   POST during disconnected periods returns 503 with a misleading
   "plugin-not-connected" message instead of 400. Not a security issue, a
   debugging-UX paper cut. Worth a small reorder when we touch the bridge in
   earnest.
2. **No cross-device reachability test** was performed (no second device
   available in this session). The single-machine 0.0.0.0 proxy failed as
   expected, but the proper test is `curl http://<LAN-IP>:3000/status` from
   another machine on the network. Recorded as a manual verification step
   the human still owes before any shared-machine use.
3. **Token warning prints on every start.** Expected — mandatory
   `BRIDGE_TOKEN` enforcement is a deferred safety-report Block (§10), not
   in the pre-Stage-2 mitigation list, and acceptable for a single-developer
   localhost setup. Will need to revisit when master-app talks to the bridge.

## Pending — GUI-required work

| Stage | Action | Owner |
|---|---|---|
| 2C | Open InDesign 2024+, launch UXP DT, add `plugin/`, capture permission-prompt screenshots, load plugin, open Bridge Panel, confirm bridge logs `Plugin connected` | human |
| 2D | curl `/execute` with `{code:"return { ok:true, docs: app.documents.length };"}`, confirm 200 + correct shape, time the round-trip | human |
| 2E | 7 lifecycle tests (bridge restart, plugin reload, force-quit InDesign, kill bridge, 5 concurrent, render-shaped concurrent, disconnect UX) | human |
| 2F | Append results + screenshots / 60-second recording to STAGE-2-NOTES.md, commit | human |

A more detailed checklist (commands, expected outputs, failure modes) was
sent inline in the conversation immediately before this report. STAGE-2-NOTES.md
will be the canonical record once results land.

## Commits added in Stage 2

```
f5829f5 docs: record Stage 2B bridge runtime verification
b513f02 safety: patch path-to-regexp via npm audit fix
```

Plus the earlier mitigation commits leading into Stage 2 (already tagged at
`stage-1.5-complete`):

```
adb3f02 docs: stage 2 prompt branch reference
1ee2156 docs: add STAGE-2-NOTES capturing pre-stage-2 verification outcomes
19886c9 docs: explain plugin manifest permissions choice
bc53ef6 chore: pin node engine to >=18
0140e21 safety: validate file paths against traversal
03800b1 safety: disable executeScript tool in all registration sites
```

## Working tree

Clean of unstaged changes. Intentionally untracked:
`analysis/safety-report.md`, `prompt.md`, `stage-1.5_prompt.md`,
`pre-stage-2-prompt.md`. (`stage-2-prompt.md` was tracked when its branch
references were updated; this report joins them as a tracked summary if
committed.)

## Deferred items still owed before Stage 4 / public deployment

Pulled forward from STAGE-2-NOTES.md "Deferred to Stage 4" so they don't get
lost:

- Mandatory `BRIDGE_TOKEN` (currently warns and continues — should
  `process.exit(1)` if unset).
- Tighten `plugin/manifest.json` `network.domains` from `"all"` to an
  explicit allow-list of `ws://127.0.0.1:3001` and `ws://localhost:3001`.
- Reconnect / disconnect UX strategy for the dashboard (depends on Stage 2E
  outcomes).
- Concurrent-request handling strategy (depends on Stage 2E outcomes).
- Reorder `/execute` checks (paper cut from Stage 2B).
