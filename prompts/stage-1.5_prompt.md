# Prompt: Safety verification of indesign-uxp-server before integration

## Your task

You previously produced `analysis/findings.md` based on the prompt in `prompt.md`. The recommendation was Option C (fork the plugin only, drop the bridge and MCP server). Before any code runs on this machine, we need a thorough safety pass to confirm the repo is safe to install, run, and integrate.

This stage is **read-only and analysis-only**. You may not run `npm install`, execute any code, install any tooling, or make network requests beyond what `view` tool reads from disk. If you find yourself wanting to run something to verify a hypothesis, write it down as a manual verification step for the human instead.

Output goes in `analysis/safety-report.md`. Use clear sections, cite file paths and line numbers for every claim, and explicitly mark each finding as Pass / Concern / Block.

## Definitions

**Pass** — verified safe, no action needed before Stage 2.
**Concern** — safe with mitigation; document the mitigation needed.
**Block** — must be resolved before Stage 2 begins.

## Section 1: Plugin manifest analysis

Locate the UXP plugin's `manifest.json`. Read it line by line.

For each declared permission, document:
- The permission name (e.g., `network`, `localFileSystem`, `clipboard`, `webview`, `enableSWCSupport`)
- The scope or value declared (e.g., `network: { domains: ["*"] }` vs `network: { domains: ["localhost"] }`)
- What that permission grants the plugin
- Whether the scope is appropriate for our use case (which is: render templates → populate frames → export PDF, all locally)
- Pass / Concern / Block rating

Specific things to flag:
- Network permissions broader than `localhost` or `127.0.0.1`
- Filesystem permissions broader than what the plugin actually uses
- Any permission that would let the plugin reach external services
- Any permission that would let the plugin execute arbitrary code from external sources

State the minimum-viable manifest we'd need for Option C (just the operations we'll keep). List any permissions we should remove from the manifest before loading the plugin.

## Section 2: Dependency tree audit

Read every `package.json` in the repo. For each one:
- List all `dependencies` and `devDependencies` with their version ranges
- Flag any dependency pinned to a git URL, commit hash, or local path (rather than a semver from npm)
- Flag any dependency you don't recognize as a well-known package
- Flag any dependency whose name looks similar to a popular package (typosquatting check)
- Flag any dependency that hasn't been updated in over 2 years (note this is a heuristic — check the package's npm page if you can access cached info)

For each `package-lock.json` or `pnpm-lock.yaml`, note its presence. We will not run `npm install` to regenerate it; the human will do that manually after this report.

Output a table: `package | version | known? | last update (rough) | concern level | notes`.

## Section 3: Network behavior audit

Read every file that touches the network. This includes the bridge, the MCP server, and the plugin's WebSocket client.

Document:
- Every port the code binds to or connects to, with file path and line number
- The default bind address for any server (`0.0.0.0`, `127.0.0.1`, `localhost`, or `undefined` which usually means all interfaces)
- Whether each server has authentication, authorization, or any access control
- Whether each server logs requests, and what's logged
- Any outbound network calls the code makes, and to where
- Any environment variables that affect network behavior

Specific things to flag:
- Servers binding to `0.0.0.0` by default
- Endpoints that accept arbitrary code execution (eval, dynamic import, `Function()` constructors)
- Endpoints that don't validate input shape before dispatching
- Logging that captures sensitive data (full request bodies, file paths, user data)
- Any hardcoded URLs, tokens, or credentials

For each finding, propose the specific code change needed (one-liner OK) to make it safe for our use case.

## Section 4: Filesystem behavior audit

Read every file that touches the filesystem. This includes anywhere the bridge or plugin writes files, reads files, or executes paths.

Document:
- Every path the code reads from or writes to, with file path and line number
- Whether paths are constructed from user input (and if so, whether they're sanitized)
- Whether the code uses absolute paths, relative paths, or temp directories
- What happens to temp files (cleaned up? left around?)
- Whether file operations check permissions before executing

Specific things to flag:
- Path traversal vulnerabilities (`../` not stripped from input)
- Writes to paths outside the working directory or temp
- Reads from paths that include user-controlled segments
- Anywhere the code shells out (`exec`, `spawn`, child_process)

## Section 5: Code execution surface

Search the entire repo for these patterns:
- `eval(`
- `new Function(`
- `vm.runInNewContext`, `vm.runInThisContext`
- `child_process.exec`, `child_process.spawn`, `child_process.execSync`
- `executeScript`, `runScript`, or any handler that takes code as a string parameter
- Use of `app.doScript` in the InDesign plugin (UXP's escape hatch to ExtendScript)

For each match, document:
- File path and line number
- What code or string is being executed
- Where the input comes from (hardcoded? user input? network input?)
- Whether the input is validated or sandboxed
- Pass / Concern / Block rating

The `executeScript` tool flagged in Section 7.1 of the original analysis is the headline item here. Confirm:
- Whether it can be disabled by removing its registration from the tool router
- Whether removing it breaks any other tool that depends on it
- The exact one-line change needed to disable it cleanly

## Section 6: Logging and telemetry audit

Search for:
- `console.log`, `console.error`, `console.warn`
- Any logging library (`winston`, `pino`, `bunyan`, etc.)
- Any analytics or telemetry calls
- Any error reporting services (Sentry, Bugsnag, etc.)

Document what gets logged where. Flag:
- Any logs that include user data, file contents, or credentials
- Any telemetry that phones home to a third-party service
- Any error reporting that ships stack traces or context off-machine

For our use case, we want zero outbound telemetry. Confirm whether the repo has any.

## Section 7: Build and tooling concerns

Document:
- What build steps run before the plugin or bridge can execute (webpack, esbuild, tsc, etc.)
- Whether the build downloads anything from the network
- Whether there are pre-install or post-install scripts in any `package.json` (`preinstall`, `postinstall`, `prepare`)
- Whether the plugin needs to be repackaged after edits or loaded as-is

Flag:
- Any postinstall scripts that run code (these are a common supply-chain attack vector)
- Any build step that fetches code from a non-versioned source
- Any build artifacts checked into the repo (these should be regenerated, not trusted)

## Section 8: InDesign plugin behavior

The plugin runs inside InDesign's process and has access to the InDesign DOM via the `app` global. Document:
- What documents the plugin can open, modify, or save
- Whether the plugin can modify InDesign preferences, scripts panel, or other persistent settings
- Whether the plugin's lifecycle is tied to a panel being visible, or runs in the background regardless
- Whether the plugin persists state between sessions (config files, cached data, etc.)
- Where any persisted state would live on disk

Specific things to flag:
- Plugin code that modifies application preferences silently
- Plugin code that touches files outside the working document
- Plugin code that registers persistent event listeners on InDesign (could outlive the test session)

## Section 9: Specific verifications for our use case

Confirm or deny each of the following:

1. The plugin can be loaded via UXP Developer Tool without modification (assuming we don't change the manifest).
2. The plugin's WebSocket client connects only to `localhost` / `127.0.0.1` by default. If not, where does it connect?
3. The bridge's HTTP server can be configured to bind to `127.0.0.1` only via a single code change. State the change.
4. The `executeScript` tool can be disabled via a single code change. State the change.
5. The plugin requires no internet connectivity to function (assuming the bridge is running locally).
6. There are no hardcoded API keys, tokens, or credentials anywhere in the repo. (Search for patterns like `sk_`, `pk_`, `Bearer `, `api_key`, `apikey`, `secret`, `token =`, `password =`.)

## Section 10: Pre-Stage-2 mitigation list

Based on findings above, produce a concrete checklist of changes the human needs to make to the repo before Stage 2 begins. For each item:
- File path and line number
- Current code (one-liner)
- Replacement code (one-liner)
- Why the change matters
- Block / Concern / Nice-to-have

Order by severity. Block items must all be done; Concern items should be done; Nice-to-haves are optional.

Also list any files or directories that should be deleted before Stage 2, with reasoning. For Option C (fork plugin only), this should include the MCP server folder and most of the bridge.

## Section 11: Final go/no-go recommendation

Write a one-paragraph recommendation:
- **Go**: repo is safe to proceed to Stage 2 after applying the mitigation list. State this clearly.
- **Conditional go**: repo is safe with specific caveats. List them.
- **No-go**: repo has issues serious enough that we should reconsider Option C and possibly start fresh. Explain why.

## Working notes

- Do not run `npm install`, do not execute any code, do not make network requests beyond viewing files.
- If a section requires running code to verify (e.g., "does this server actually bind to 0.0.0.0 at runtime"), state it as a manual verification step for the human.
- Cite specific file paths and line numbers throughout.
- Be concrete about mitigations — "change line X to Y" is more useful than "this should be fixed."
- Keep `analysis/safety-report.md` to roughly 1500-2500 words. If shorter is enough, shorter is better.

## When you're done

Print a 3-line summary: number of Pass items, number of Concern items, number of Block items, and your go/no-go recommendation. Then stop. Don't begin Stage 2 work.