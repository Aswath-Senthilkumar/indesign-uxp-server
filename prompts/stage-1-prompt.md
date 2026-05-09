# Prompt: Analyze indesign-uxp-server for the team-sheet automation project

## Your task

You are working in a freshly forked clone of `theloniuser/indesign-uxp-server`. Your job is **not** to write or modify code yet. Your job is to read the repository carefully and produce a written analysis that helps me decide what to lift, what to drop, and what to rewrite for our use case.

Output goes in `analysis/findings.md` (create the folder). Use clear sections, code citations with file paths and line numbers, and concrete examples. Where you're uncertain, say so and point at what would resolve the uncertainty.

Do not write production code in this pass. You may write small throwaway scripts in `analysis/scratch/` if you need to test a hypothesis (e.g., "does this WebSocket handler actually reconnect on close?"), but flag them as scratch.

## Context you need before reading the repo

### What we're building

A website (likely inside an existing Next.js app called master-app, possibly standalone for v1) that lets a marketing manager named Hannah generate "team sheets" — 12-tile property marketing PDFs — by selecting comps from a database and rendering them through pre-designed Adobe InDesign templates.

The render flow:
1. User picks a template (one of ~7 standing `.indd` files designed by Hannah)
2. Searches and selects comps by address from a comp database
3. System enriches each comp's missing fields (square footage, acreage, photos) from internal sources or external APIs
4. User arranges tile order via drag-and-drop
5. User hits render
6. System opens the bound `.indd` template inside a running InDesign instance, populates named text frames and image frames per tile, exports a PDF using a specific export preset, returns the PDF for inline preview
7. User reviews and saves

We have decided this is the right architecture (deterministic render through real InDesign templates, PDF identical to manual exports). What we have not decided is whether to fork this repo, strip it, or rewrite from scratch using its plugin code only as a reference.

### The expanded operation set we anticipate needing

Beyond the basic populate-and-render path, brokers will eventually edit populated sheets in-place via a CMS-style UI. That requires the plugin to support:

- Open document, close document, save as
- Set text in named text frame (with optional formatting)
- Place image in named image frame (with fitting options)
- Get/set frame fill color and stroke color
- Get/set frame visibility
- Get frame geometry (position, size)
- Set frame geometry (for layout reshape)
- Duplicate frame
- Add page, remove page, apply master spread to page
- Export PDF with a specified preset
- List named frames on a page (introspection)
- Native InDesign undo/redo

Plus eventually: variable tile count handling, multi-page overflow, grid reshape based on selected comp count.

### What we know about UXP plugins generally

UXP is Adobe's modern plugin runtime, replacing ExtendScript. Plugins are HTML/JS folders with a `manifest.json` declaring permissions. They run inside InDesign 2024+ and have direct access to the InDesign DOM via the `app` global. They can hold WebSocket connections out to localhost services. They can read/write local files if the manifest declares `localFileSystem` permissions.

UXP is *not* the same as ExtendScript or Node. Common Node libraries don't run; some web APIs are sandboxed. The runtime is Chromium-based but with restrictions.

### The repo's stated architecture (from its README)

Three layers:
1. An MCP server (Node, exposes ~130 tools to a Claude-style MCP client)
2. An HTTP/WebSocket bridge (Node, ports 3000/3001)
3. A UXP plugin running inside InDesign

The plugin holds a persistent WebSocket connection to the bridge. The bridge accepts requests from the MCP server (or from any HTTP/WS caller) and forwards work to the plugin as JS code strings or structured operations.

## What I need you to produce

### Section 1: Repository inventory

Walk the directory structure. Write a tree of the top-level layout. For each significant folder, summarize what it contains in 1-2 sentences. Identify:

- Which folder holds the UXP plugin source
- Which folder holds the bridge / WebSocket server
- Which folder holds the MCP server
- Where tests live
- Where the manifest.json sits
- Any build/bundling tooling (e.g., webpack, esbuild, tsup)
- Any config files that gate behavior (e.g., port numbers, paths to InDesign)

### Section 2: License and provenance

Locate the LICENSE file. State the license type verbatim. Note the original author and the date of the most recent commit. Check if it's a fork — does the README, package.json, or commit history reference an upstream like `zachshallbetter/indesign-mcp-server`? If yes, note what was changed in this fork.

### Section 3: The plugin layer in detail

This is the most important section. Read every file in the plugin folder.

**Document its structure:**
- What does `manifest.json` declare? List the permissions, entry points, and any host app constraints (e.g., minimum InDesign version).
- What's the entry point? How does the plugin bootstrap?
- How does it establish the WebSocket connection to the bridge? Does it reconnect on disconnect? With what backoff?
- How are inbound messages parsed and dispatched?

**Document its operation surface:**
- List every operation/tool the plugin can execute, organized by category (document, page, text, image, frame, color, style, export, master, application).
- For each operation, note: the operation name as the bridge calls it, the InDesign DOM API it wraps, the parameters it accepts, what it returns, what errors it raises.
- Identify which operations map to ones I listed in the "expanded operation set we anticipate needing" above. Mark each with: ✅ exact match, 🟡 partial match (explain the gap), ❌ missing.

**Document patterns that look load-bearing:**
- How does it handle async errors and unhandled rejections?
- How does it handle the case where a named frame doesn't exist?
- How does it handle multi-document state? (Is `app.activeDocument` assumed everywhere, or is there explicit document tracking?)
- How does it wrap InDesign DOM calls — direct calls, helpers, a query/specifier pattern?
- Does it use any UXP-specific lifecycle hooks (panel show/hide, document open/close events)?

**Document any tooling-specific concerns:**
- Is there a build step or is the plugin loaded as-is?
- How is hot-reload during development handled?
- Are there debug logs, and where do they surface?

### Section 4: The bridge layer

Read the bridge code.

- What's the network shape? HTTP endpoints, WebSocket endpoints, ports.
- What's the message protocol between bridge and plugin? JSON with structured ops, or JS code strings to eval?
- How does the bridge match responses to requests when multiple ops are in flight? (request IDs? sequential blocking?)
- How does the bridge handle the case where the plugin disconnects mid-operation?
- Are there any rate limits, queues, or concurrency controls?
- Does the bridge cache anything? (open documents, last result, etc.)

### Section 5: The MCP server layer

Read the MCP server code.

- How does it expose tools? Does each tool wrap one bridge operation, or are tools higher-level compositions?
- What's the tool count? List the tool names grouped by category.
- How are tool descriptions and parameter schemas defined? (Manually written, generated from types, etc.)
- Are there tools that compose multiple plugin operations into one (e.g., "populate template" that opens, sets many fields, and exports)? List any composite tools.

For our use case we are likely to drop the MCP server layer entirely (master-app will call the bridge directly via HTTP). Confirm whether this is feasible — i.e., is the bridge usable without the MCP server, or is there coupling?

### Section 6: Gap analysis vs our needs

For each operation in our expanded set (listed above):

- Is it present in the plugin? Cite file path and function name.
- If present, does it match our needs exactly? If not, what would we need to modify?
- If absent, what's the closest existing operation, and how much code would adding ours likely require?

Specifically check for:

- **Named frame addressing.** Does the plugin support `itemByName` for both text frames and graphic frames? Does it handle invalid names gracefully?
- **Image fitting after place.** Does `placeImage` set `FitOptions` after placing, or does it leave the image at native size?
- **PDF export presets.** Does the export operation accept a preset name, or is preset hardcoded?
- **Document close without save.** Is there a `close(SaveOptions.NO)` path, or does close save by default?
- **Color manipulation.** Can it set `fillColor` on a frame using either an existing swatch or a freshly-created `Color` object?
- **Frame geometry.** Can it both read `geometricBounds` and set them?
- **Page operations.** Can it add a page, remove a page, and apply a master spread to a page?
- **Frame introspection.** Is there an operation that lists all named frames on a page or in a document?
- **Master spread access.** Can it differentiate edits to master pages vs document pages?

### Section 7: Concerns and red flags

Flag anything that worries you. Examples of what might warrant a callout:

- Permission scopes broader than needed (e.g., requesting full network access for what should be localhost-only)
- Eval'ing arbitrary JS code strings from the bridge (security implication)
- Long functions with many responsibilities
- Comments hinting at known bugs or unfinished work (TODO, FIXME, HACK)
- Tests that look superficial (testing that a function exists, not that it works)
- Any reliance on InDesign features that have known UXP bugs
- Hardcoded paths or magic numbers that would break in our environment

### Section 8: Recommendation

Based on everything above, write a clear recommendation on which of the following paths to take:

**A. Fork-and-strip.** Keep the repo as our starting point. Delete what we don't need (probably most of the MCP server, many tools, possibly some plugin operations). Modify the rest to fit. Estimate: how many files to delete, how many to modify, how many to add new. Estimate effort in dev-days.

**B. Reference-and-rewrite.** Use the repo only as a reference for UXP patterns and InDesign DOM usage. Write our own minimal plugin from scratch. Use the repo's bridge as inspiration but not as code. Estimate: total lines of code we'd write, reusing patterns we observed.

**C. Fork the plugin only.** Keep the plugin folder, drop the bridge and MCP server. Build our own bridge tailored to our HTTP/WS protocol with master-app. Estimate: lines kept, lines new.

For each option, list pros, cons, and a realistic effort estimate in dev-days. State which option you'd recommend and why.

### Section 9: Open questions

End with a list of questions that, if answered, would make the recommendation more confident. These should be specific things — questions the next reader (me) can investigate by looking somewhere specific, asking someone, or running an experiment.

## Working notes

- Use the `view` tool to read files. Don't run code in the repo without good reason.
- If something looks like it requires running InDesign to verify (e.g., "does this operation actually work"), don't try to run it — just flag it as needing verification.
- Cite specific file paths and line numbers throughout. Make it easy for me to verify your claims.
- Be honest about uncertainty. If a section of the code is opaque or undocumented, say so.
- Don't pad. If a section has nothing interesting to say, say "Nothing notable here" and move on.
- Keep `analysis/findings.md` to roughly 2000-3000 words. If it goes longer, that's fine as long as the length is earned.

## When you're done

Print a one-paragraph summary of what you found and your recommendation, then stop. Don't start writing code. I'll review the analysis, ask follow-up questions, and decide on a direction before any code gets written.