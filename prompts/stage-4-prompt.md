# Stage 4 — Standalone dashboard for the team-sheet renderer

You are running Stage 4 of an InDesign UXP automation project. Read this entire prompt before starting. Then begin Stage 4.1.

## Context

Stage 3 closed with a working one-tile render through Hannah's actual `.indd` template via the bridge → plugin → InDesign DOM pipeline. The user has since extended that to a six-tile multi-render in `test-render.js` (Stage 3.7), batching all populate operations into a single `/execute` call followed by one PDF export. Total render time for six tiles is in the 8-10 second range.

The render path is solved. Stage 4 is about wrapping a usable web interface around it so Hannah can drive a render herself rather than running a CLI script.

## Stakeholder context

This dashboard is a prototype for a Hannah review. It does NOT need to be production-grade. It needs to be good enough that Hannah can:

1. Pick a template (one option for now — the six-tile template)
2. Search and select six comps from the mock data
3. Order the selected comps
4. Hit render
5. See an inline preview of the rendered PDF
6. Download the PDF if it looks right

That's it. No auth, no persistence, no edit-after-render flow, no template switching, no real `comps` data integration. Those are post-Hannah-review features.

After Hannah approves the design, the review chain continues: Liam → Jon → Max. The dashboard's placement (inside master-app or standalone) is deferred until Max sees it. For now, **build standalone**.

## How you operate in this stage

You will scaffold, write code, run dev servers, and verify outputs autonomously. You will pause and ask the user to act whenever a step requires:

- GUI interaction in InDesign or the browser
- Visual inspection of a rendered output
- A judgment call about UX or design that has multiple defensible answers
- Something that depends on the user's preference (e.g., styling choices)

When you need the user, write your request like this:

> **Action required:** [one-line summary]
>
> 1. [step]
> 2. [step]
>
> Reply when done, or with the output if I asked for one.

Then stop and wait.

When you finish a sub-stage cleanly, do not announce it triumphantly. Note the result, commit, and move to the next sub-stage. When something fails, stop and report.

## Output structure

All Stage 4 work goes into `STAGE-4-NOTES.md` at the repo root. Match the structure of `STAGE-2-NOTES.md` and `STAGE-3-NOTES.md`. Commit incrementally as each sub-stage closes.

The dashboard itself goes in a new top-level folder: `dashboard/`. It's a Next.js app, separate from the existing `bridge/` and `plugin/` folders.

## Prerequisites — verify before starting

Run these checks. If any fails, stop and report which:

- `STAGE-3-NOTES.md` exists at repo root
- The git tag `stage-3-complete` exists (locally and pushed)
- `templates/template-v2-test.indd` exists
- `test-render.js` at repo root is the multi-tile version (Stage 3.7) that batches operations into one `/execute` call
- `mock-data/comps.json` has at least six entries with valid image references
- Working tree is clean (`git status`)

Run `git log --oneline -5` and confirm Stage 3 commits are present.

If all checks pass, begin Stage 4.1.

---

## Stage 4.1 — Scaffold the dashboard

Create a standalone Next.js app at `dashboard/`.

Stack:
- Next.js 16 with App Router
- TypeScript
- Tailwind CSS v4
- shadcn/ui for components

Use `pnpm` if available, otherwise `npm`. Match whatever the user has been using in `bridge/`.

Run the scaffold (e.g., `npx create-next-app@latest dashboard --typescript --tailwind --app --no-src-dir --no-eslint --use-pnpm`). Once scaffolded:

1. Initialize shadcn/ui in `dashboard/` with default config and a sensible base color (slate or zinc).
2. Install the components we'll need: `button`, `input`, `card`, `select`, `label`, `separator`. Don't install everything — pull what's needed when needed.
3. Add a top-level layout with a single page at `/` for the dashboard. No sidebar, no navigation, no header chrome beyond a simple title.

Confirm the scaffold runs:
- `cd dashboard && pnpm dev` (or `npm run dev`)
- Browser shows the default Next.js page on `http://localhost:3000`

Then ask:

> **Action required:** Confirm the dashboard scaffold runs.
>
> 1. Visit `http://localhost:3000` in your browser
> 2. Confirm a Next.js page loads without errors
> 3. Reply when confirmed.

Wait for confirmation.

Important: the dashboard runs on port 3000 by default, but the **bridge also runs on port 3000**. We need to change one. Change the dashboard to run on port 4000 (`pnpm dev -- --port 4000` or set in `package.json` scripts as `"dev": "next dev --port 4000"`). The bridge stays on 3000 — that's the contract everything else assumes.

Restart the dashboard on 4000 and confirm again with the user.

Record the scaffold setup in `STAGE-4-NOTES.md`. Commit as `feat: stage 4.1 scaffold dashboard`.

---

## Stage 4.2 — Render API endpoint

The dashboard needs an API route that accepts a render request from the browser and forwards it to the bridge. The browser cannot talk to the bridge directly — the bridge binds to localhost only and the dashboard's API route is the bridge's caller.

Create `dashboard/app/api/render/route.ts`. It should:

1. Accept POST requests with a JSON body containing `{ template: string, comps: Comp[] }` where `Comp` is an object with the same shape as `mock-data/comps.json` entries.
2. Validate the request — at minimum, ensure six comps are provided and each has the required fields.
3. Read the image bytes for each comp from `mock-data/images/` (use `fs.promises.readFile`, write to a temp dir if needed for the bridge to access).
4. Build the same batched JS code string that `test-render.js` produces — one `/execute` call that opens the template, populates all six tiles, and exports the PDF.
5. POST that to `http://127.0.0.1:3000/execute`.
6. On success, return the PDF as a binary response with `Content-Type: application/pdf` so the browser can preview it inline.
7. On error, return a structured error JSON with appropriate HTTP status.

Reuse the formatting helpers from `test-render.js` (SF/AC formatting, etc.) — refactor them into a shared module like `dashboard/lib/format.ts` rather than duplicating.

> **Action required:** Pre-flight check before testing the API route.
>
> 1. Confirm the bridge is running on port 3000 (`cd bridge && node server.js`)
> 2. Confirm InDesign 2024+ is open with `template-v2-test.indd` as the active document
> 3. Confirm the plugin is loaded and connected to the bridge
> 4. Reply when ready.

Wait for confirmation.

Test the API route directly with curl from a terminal:

```
curl -X POST http://localhost:4000/api/render \
  -H "Content-Type: application/json" \
  -d '{"template":"template-v2-test","comps":[<six comps from mock-data/comps.json>]}' \
  --output dashboard-test-render.pdf
```

Verify:
- Response is 200 OK
- `dashboard-test-render.pdf` is created
- File size is greater than 50 KB
- Total request time is under 15 seconds

Ask the user to open the PDF and confirm it looks the same as the Stage 3.7 multi-tile output.

> **Action required:** Open `dashboard-test-render.pdf` and confirm it matches the Stage 3.7 multi-tile render. Reply with "matches" or with what's different.

If anything differs, stop and ask how to proceed.

Record the API route setup and test results in `STAGE-4-NOTES.md`. Commit as `feat: stage 4.2 render API endpoint`.

---

## Stage 4.3 — Comp picker UI

Build the page at `dashboard/app/page.tsx` with the comp selection interface.

Layout (top to bottom):
1. A page title — something like "Team Sheet Renderer" or "RGCRE Team Sheets" — keep it minimal.
2. A template label showing "Template: 6-tile sample (template-v2-test)" — no selector yet, just static text. We'll add a selector later if needed.
3. An address search input that filters the mock comps in real time.
4. A list of available comps below the search, showing for each:
   - Address, city/state on one line
   - Building SF and acreage on a second line
   - A small thumbnail of the property image
   - A button to add the comp to the selection
5. A "Selected (N/6)" section above or beside the list, showing the comps the user has picked, in order. Each selected comp has a remove button.
6. A "Render" button at the bottom, disabled unless exactly six comps are selected.

Use shadcn/ui components throughout. Use Tailwind for layout. Don't over-design — clean and functional, no animations or fancy interactions yet.

Mock comp data is loaded by reading `mock-data/comps.json` on the server (via a server component or a server-side route). Don't try to upload or POST it from the client.

Selection ordering: for v1, the order in which the user clicks "add" is the order they appear in the selected list. No drag-and-drop reordering yet — that's a follow-up if Hannah requests it.

> **Action required:** Test the picker UI.
>
> 1. Open `http://localhost:4000` in your browser
> 2. Confirm the comp list loads from mock-data
> 3. Try the address search — typing "elwood" should filter to the Elwood St comps
> 4. Add 6 comps to the selection
> 5. Try removing one and re-adding a different one
> 6. Confirm the "Render" button enables only when exactly 6 are selected
> 7. Reply with anything that's broken or feels off.

Wait for confirmation.

Iterate on any issues the user reports. Don't move on until the picker is functionally clean.

Record the picker UI in `STAGE-4-NOTES.md`. Commit as `feat: stage 4.3 comp picker UI`.

---

## Stage 4.4 — Render button + PDF preview

Wire the render button to the API endpoint.

Behavior:
1. User clicks Render with 6 comps selected
2. Button shows a loading state ("Rendering...")
3. Browser POSTs to `/api/render` with the selection
4. On success, the response PDF is rendered inline in a preview pane below or beside the picker
5. A "Download" button appears next to the preview, allowing the user to save the PDF locally
6. On error, an error message displays clearly with the bridge's error text

For the PDF preview:
- Use `<embed src={pdfBlobUrl} type="application/pdf" />` for v1 — simplest, works in all major browsers
- The blob URL is created from the API response: `URL.createObjectURL(await response.blob())`
- Revoke the blob URL when the user re-renders (avoid memory leaks)

> **Action required:** End-to-end test of the dashboard.
>
> 1. Confirm the bridge is still running and InDesign is still open with the template
> 2. In the dashboard, select 6 comps
> 3. Click Render
> 4. Wait for the preview to appear (should be 8-12 seconds)
> 5. Confirm the PDF preview shows the rendered sheet
> 6. Click Download and confirm the PDF saves locally
> 7. Open the saved PDF and verify it looks correct
> 8. Reply with how it went.

Wait for confirmation.

Iterate on any issues. Don't move on until end-to-end works.

Record in `STAGE-4-NOTES.md`. Commit as `feat: stage 4.4 render button and PDF preview`.

---

## Stage 4.5 — Polish

Once the end-to-end flow works, spend a focused half-day on polish. Don't over-invest.

In priority order:

1. **Error handling.** What happens when the bridge isn't running? When InDesign isn't open? When the plugin is disconnected? Each should produce a clear, actionable error message in the UI, not a cryptic 500. Test each by stopping the bridge or closing InDesign and clicking render.

2. **Loading states.** The render button shows a spinner. The comp list shows a skeleton or "Loading..." message during initial load. The preview area shows a placeholder before the first render.

3. **Empty states.** What does the search show when nothing matches? What does the selected list show when empty?

4. **Visual polish.** Reasonable spacing, font sizes, and alignment. Use shadcn defaults where possible. Don't try to make it pretty — make it not-ugly.

5. **Image thumbnails.** Property images in the picker should be small (maybe 60×60px), object-fit-cover, with rounded corners. Lazy-load if possible.

Stop polishing when the dashboard works and looks acceptable. Don't gold-plate. Hannah's review is about whether the workflow is right, not whether the colors are perfect.

Record in `STAGE-4-NOTES.md`. Commit as `feat: stage 4.5 dashboard polish`.

---

## Stage 4.6 — Internal dry run

Before showing Hannah, run the dashboard yourself a few times with different comp combinations.

Tasks:

1. Render with a different set of 6 comps (e.g., the last 6 in mock-data instead of the first 6). Confirm it works.
2. Render twice in a row without restarting the bridge. Confirm subsequent renders work cleanly (no stale state, no document leaks).
3. Try selecting 5 comps and clicking render — button should be disabled.
4. Try removing a selected comp and adding a different one before rendering.
5. Try the search filter with various queries — partial street name, city name, no match.
6. Render once, then change the selection, render again — preview should update with the new render.

Document any rough edges in `STAGE-4-NOTES.md`. Fix the ones that would obviously confuse Hannah. Defer the ones that wouldn't.

Commit as `feat: stage 4.6 dry run iteration`.

---

## Stage 4.7 — Stage 4 wrap-up

If 4.6 went cleanly:

1. Add a one-page Stage 4 summary to `STAGE-4-NOTES.md`. Include:
   - Sub-stages completed
   - Total render time observed across multiple runs (median, max)
   - Any rough edges fixed during dry run
   - Any rough edges deferred to post-Hannah work
   - Commits added in Stage 4
   - Hannah review prerequisites met

2. Tag the current commit as `stage-4-complete`. Ask the user before pushing.

3. Print a closing summary:
   - Total commits added in Stage 4
   - Tag created (and whether pushed)
   - Hannah review readiness
   - Open items the user should know about before scheduling Hannah

4. Stop. Do not begin any post-Hannah work.

If 4.6 surfaced issues that haven't been resolved, do NOT close Stage 4. Document open items and ask the user how to proceed.

---

## Working notes

- Cite file paths and commit hashes throughout.
- Don't run `git push` without confirming with the user.
- Don't modify `bridge/`, `plugin/`, or `test-render.js` — they're stable. The dashboard is additive.
- If the user says "stop" at any point, stop.
- Be brief in status messages.

## When you're done

Print a 3-line summary:
- Stage 4 status (complete / blocked / pending user input)
- End-to-end render: works / has issues
- Recommendation: ready for Hannah review / needs iteration

Then stop.