# Prompt: Stage 2 — Bridge and plugin integration setup

## Prerequisites

Before starting this stage, verify:

- [ ] `analysis/findings.md` exists and was reviewed
- [ ] `analysis/safety-report.md` exists and was reviewed
- [ ] All Block-level items from the safety report have been resolved
- [ ] All Concern-level items have been documented or resolved
- [ ] You are working on the `analysis/initial-pass` branch, not main
- [ ] You are on a trusted network (home, not public wifi)
- [ ] InDesign 2024+ is installed and licensed
- [ ] UXP Developer Tool is installed

If any of the above are missing, stop and resolve before proceeding.

## Your task

Stand up a minimal end-to-end pipeline: bridge running, plugin loaded in InDesign, plugin and bridge talking. No template work yet — just verify the substrate is alive and behaves predictably.

You will run code in this stage. Do so deliberately. Keep `STAGE-2-NOTES.md` updated as you go with every step taken, every command run, and every issue encountered.

## Pre-flight: apply mitigations

Before installing or starting anything, read `analysis/stage-2-mitigations.md`
in full. Apply every Block-level item as a separate commit on the
`analysis/initial-pass` branch. Use the commit messages specified in the
mitigations document.

For each Block item, after the commit:
- Verify the change is correct using the verification step in the document
- Note the commit hash in STAGE-2-NOTES.md

After all four Block items are committed and verified, apply the three
Concern items as additional commits.

Only after the mitigation commits are in place do you proceed to Stage 2A.

If any verification step fails, stop and report to the human. Do not
proceed with broken mitigations in place.

## Stage 2A: Install dependencies

1. **Confirm the dependency tree before install.** Re-read `package.json` for the bridge folder. Confirm no postinstall scripts have been added since the safety audit.

2. **Install with strict mode.**
cd <bridge-folder>
npm install --ignore-scripts

The `--ignore-scripts` flag prevents pre/postinstall hooks from running. We added this for safety; if any dependency genuinely needs its postinstall (e.g., to compile native modules), it'll fail loudly and we'll evaluate then.

3. **Run `npm audit`.** Document the output in `STAGE-2-NOTES.md`. If anything Critical or High is reported, stop and review with the human before proceeding.

4. **Do the same for the plugin folder** if it has its own `package.json`.

5. **Document the installed versions.** Record `node --version` and `npm --version` for reproducibility.

## Stage 2B: Start the bridge

1. **Verify the bridge binding** before starting. Open the file where the server binds (per safety report Section 3) and confirm it's set to `127.0.0.1`, not `0.0.0.0` or undefined.

2. **Start the bridge** per the repo's documented method. Watch the startup logs. Confirm:
   - It binds to `127.0.0.1` only (verify with `lsof -i :3000` or `netstat -an | grep 3000` — should show `127.0.0.1:3000`, not `*:3000`)
   - The port is what was expected
   - No errors in startup
   - No outbound network calls in the logs

3. **Test from a non-localhost address** (if possible) to confirm the binding is enforced. From another device on your network, try to reach `http://<your-machine-ip>:3000`. It should fail to connect. Document the test in notes.

4. **Test the bridge endpoint with a no-op call** from localhost. Use `curl` or a simple Node script. Confirm the response shape matches what the bridge code says it returns.

## Stage 2C: Load the plugin in InDesign

1. **Open InDesign 2024+.** Confirm version in `Help → About` (or equivalent).

2. **Open UXP Developer Tool** (separate app from InDesign).

3. **Add the plugin** by pointing UXP DT at the plugin folder. The manifest you reviewed in the safety report should load without permission errors.

4. **Take a screenshot of any permission prompts** InDesign displays. Save to `STAGE-2-NOTES.md` as evidence of what permissions were granted.

5. **Click Load** in UXP DT. The plugin should appear in InDesign's `Window → Plugins` menu (or equivalent — exact path varies).

6. **Open the plugin panel.** Confirm:
   - Panel UI renders without errors
   - Console shows no red errors (open via UXP DT's debugger or InDesign's Developer Console)
   - Plugin attempts to connect to the bridge

7. **Verify the connection.** The bridge logs should show "plugin connected" (or equivalent). The plugin logs should show "connected to bridge" (or equivalent).

8. **If connection fails**, document the exact error and stop. Common causes: manifest network permission missing localhost, bridge not running, port mismatch, firewall blocking localhost (rare but possible on some macOS configurations).

## Stage 2D: Verify a no-op round trip

1. **Send a structured message** from a Node script (or curl) to the bridge that should be forwarded to the plugin. Pick the simplest available tool — likely something like a "ping" or "list documents" handler.

2. **Confirm the round trip:**
   - Bridge receives request, logs it
   - Bridge forwards to plugin via WebSocket, logs it
   - Plugin executes handler, returns result
   - Bridge receives response, returns to caller
   - Caller receives expected response

3. **Time the round trip.** Document approximate latency for a no-op call. We expect single-digit milliseconds.

## Stage 2E: Connection lifecycle testing

This is the verification I added explicitly. The findings report flagged that connection lifecycle wasn't deeply examined. We test it now.

For each of the following scenarios, document the observed behavior in `STAGE-2-NOTES.md`:

1. **Bridge restart while plugin is connected.** Stop the bridge process, wait 5 seconds, restart. Does the plugin reconnect automatically? How long does it take? Does the plugin's UI indicate disconnection during the gap?

2. **Plugin reload while bridge is running.** Reload the plugin via UXP DT. Does the bridge detect the disconnect? Does the new plugin instance reconnect cleanly?

3. **In-flight request when InDesign is force-quit.** Send a structured request (use one with deliberate delay if possible — e.g., open a document operation). While it's in flight, force-quit InDesign. Observe:
   - Does the bridge's HTTP request hang indefinitely?
   - Does it time out cleanly?
   - Is the error returned to the caller informative?

4. **In-flight request when bridge is killed.** Send a request, kill the bridge mid-flight. Observe whether the plugin's WebSocket detects the disconnect cleanly or hangs.

5. **Concurrent requests.** Send 3-5 requests simultaneously. Confirm responses match requests correctly (request ID correlation works).

6. **Concurrent requests.** See `analysis/stage-2-mitigations.md` Test 6.

7. **Disconnect UX.** See `analysis/stage-2-mitigations.md` Test 7.

These tests inform how robust the dashboard's error handling needs to be in Stage 4.

## Stage 2F: Document everything

`STAGE-2-NOTES.md` should now contain:
- Mitigation commits applied (with hashes)
- npm install output
- npm audit output
- Bridge startup verification
- Binding test results
- Plugin load screenshots
- Round-trip test results
- Connection lifecycle test results

End the document with a "Stage 2 complete" section that includes:
- A 60-second screen recording showing: bridge running, InDesign with plugin loaded, a successful round-trip request
- Or, if recording is impractical, sequential screenshots demonstrating the same

## Stage 2 stop-gate

When all of the above is done, the deliverable is:
1. A clean git history on `analysis/initial-pass` showing safety commits, install steps, and verification
2. `STAGE-2-NOTES.md` with all sections filled
3. A working local pipeline that can round-trip a request from caller → bridge → plugin → InDesign DOM → back

Send this to the human for review. Do not proceed to Stage 3 (template work) until reviewed.

## What success looks like

- Bridge bound to localhost only, verified
- Plugin loaded with permissions you've reviewed and approved
- Round-trip latency in single-digit milliseconds
- Connection lifecycle has known, documented behavior under failure modes
- No errors or warnings in logs that you can't explain

## What failure looks like (and what to do)

- Plugin won't load: usually manifest issue. Read the UXP DT error verbatim, check it against the safety report's manifest analysis.
- Bridge starts but plugin can't connect: usually network permission missing in manifest, or port mismatch.
- Round-trip works but with high latency (seconds, not milliseconds): something is wrong; the plugin or bridge has a blocking call somewhere. Document and pause.
- Connection lifecycle reveals hangs or unrecoverable states: not a blocker for Stage 2 completion, but document precisely. Will inform Stage 4.

If anything stops you cold, don't push through. Stop, document the issue, and bring it to the human for review.