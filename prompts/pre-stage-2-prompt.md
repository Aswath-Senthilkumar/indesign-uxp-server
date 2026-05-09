# Stage 2 mitigations and additions

This document consolidates the sign-off from the safety review and is the
canonical reference for what must be done before and during Stage 2.

## Block items (must be committed before any code runs in Stage 2)

Each item below is a required commit. Reference the safety report sections
for the original analysis.

### Block 1: Bridge binding

**Source:** safety-report.md Section 3

**File and change:** Locate the line where the HTTP server calls `.listen()`
in the bridge code. Change the bind address from `0.0.0.0` (or undefined,
which defaults to all interfaces) to `127.0.0.1`.

**Verification:** After the change, run the bridge and confirm with
`lsof -i :3000` (or equivalent) that it shows `127.0.0.1:3000`, not `*:3000`.

**Commit message:** `safety: bind bridge to 127.0.0.1 only`

### Block 2: Disable executeScript

**Source:** safety-report.md Section 5

**File and change:** Run `grep -rn "executeScript" src/` to find every
registration site. Comment out or remove every registration of the
executeScript tool — there may be more than one (likely both an MCP-tool
registration and a bridge handler registration). Both must go.

**Verification:** After the change, attempt to invoke executeScript via the
bridge. Should return an error indicating the tool is not registered.

**Commit message:** `safety: disable executeScript tool in all registration sites`

### Block 3: Path traversal protection

**Source:** safety-report.md Section 4

**File and change:** For every file operation that takes a user-supplied
path, validate the resolved path is within an allowed root. The pattern is:

```js
const path = require('path');
const ALLOWED_ROOT = path.resolve('/path/to/allowed/working/dir');

function validatePath(userPath) {
  const resolved = path.resolve(userPath);
  if (!resolved.startsWith(ALLOWED_ROOT + path.sep)) {
    throw new Error(`Path ${userPath} outside allowed root`);
  }
  return resolved;
}
```

Apply to every place the safety report flagged in Section 4.

**Verification:** Test with a payload containing `../` segments. Should be rejected.

**Commit message:** `safety: validate file paths against traversal`

### Block 4: npm audit verification

**Source:** safety-report.md Section 2 (deferred from safety pass)

**This is a verification step, not a code change.** Runs at the start of
Stage 2A as a gate. If `npm audit` reports Critical or High severity
vulnerabilities after install, stop and review with the human before
proceeding.

**Action:** During Stage 2A, run `npm install --ignore-scripts` followed
by `npm audit`. Capture output in STAGE-2-NOTES.md. Stop and ask if
Critical or High issues appear.

## Concern items (apply during Stage 2 setup, document if deferred)

### Concern 1: Pin Node version

In every `package.json` we'll keep, add:

```json
"engines": {
  "node": ">=18.0.0"
}
```

**Commit message:** `chore: pin node engine to >=18`

### Concern 2: Document manifest permissions reasoning

In the plugin's `manifest.json`, add a top-of-file comment (or a sibling
README in the plugin folder) explaining why `localFileSystem: fullAccess`
is required: Hannah's templates may live in OneDrive synced folders;
exported PDFs need to go to user-chosen locations; the more granular
`extensions-only` scope would force a fixed plugin-managed directory which
doesn't fit the use case.

**Commit message:** `docs: explain plugin manifest permissions choice`

### Concern 3: Verify executeScript fully disabled

After Block 2, confirm with grep that no executeScript references remain
active in any router, handler registration, or tool list. Document the
search and result in STAGE-2-NOTES.md.

## Stage 2 verification additions

These are additional tests for Stage 2E's lifecycle testing, beyond what
prompt-2.md originally specified.

### Test 6: Concurrent requests

Send two render-shaped sequences (open document → setText → close)
simultaneously. Document whether they interleave, queue, or error.
This informs Stage 4 dashboard's render queue design.

### Test 7: Disconnect UX

While the plugin is disconnected from the bridge, attempt a UI action that
would normally send a message. Document the plugin's behavior — silent
drop, error display, queue-and-retry, or freeze.

### Updated success criteria

Add to "What success looks like" in prompt-2.md:
- Concurrent requests handled predictably (either serialized cleanly or
  rejected with clear error)
- Plugin disconnect UX is documented, even if it's "user sees nothing happen"

## Deferred to Stage 4 (note now, build later)

These were flagged during sign-off but are not Stage 2 work. Recording here
so they don't get lost.

- **Token-based auth** between master-app and bridge. Even on localhost,
  worth implementing for defense-in-depth and to support the eventual case
  where they run on different machines.
- **Concurrent-request handling strategy.** The lifecycle test in 2E will
  reveal how the plugin behaves; Stage 4 needs to design around that.
- **Reconnect-while-disconnected user experience.** What happens when a
  broker clicks "render" while InDesign is restarting? Stage 4 dashboard
  needs an answer.