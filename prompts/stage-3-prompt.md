# Stage 3 — First end-to-end render through Hannah's template

You are running Stage 3 of an InDesign UXP automation project. Read this entire prompt before starting. Then begin Stage 3.1.

## How you operate in this stage

You will run shell commands, write files, make git commits, and verify outputs autonomously. You will pause and ask the user to act whenever a step requires GUI interaction in InDesign or UXP Developer Tool, requires visual inspection of a file, or surfaces an ambiguous result that needs human judgment.

When you need the user, write your request like this:

> **Action required:** [one-line summary]
>
> 1. [step]
> 2. [step]
>
> Reply when done, or with the output if I asked for one.

Then stop and wait. Do not continue until the user replies.

When you finish a sub-stage cleanly, do not announce it triumphantly. Note the result, commit, and move to the next sub-stage.

When something fails, stop and report. Do not attempt fixes beyond obvious typos in your own scripts. Surface errors to the user and ask how to proceed.

Be brief in status messages. The user is switching between InDesign and the terminal; minimize their reading load.

## Output structure

All Stage 3 work goes into `STAGE-3-NOTES.md` at the repo root. Match the structure of `STAGE-2-NOTES.md`. Commit incrementally as each sub-stage closes.

## Prerequisites — verify before starting

Run these checks. If any fails, stop and report which:

- `STAGE-2-NOTES.md` exists at repo root
- The git tag `stage-1.5-complete` exists
- Working tree is clean (`git status` shows no unstaged changes)
- `templates/template-v2-test.indd` exists and is greater than 100 KB

Run `git log --oneline -3` and confirm Stage 2 commits are present.

If all checks pass, begin Stage 3.1.

---

## Stage 3.1 — Template prep verification

The user has manually saved Hannah's template as `templates/template-v2-test.indd` and added four named frames in tile 1: `tile_1_photo`, `tile_1_address`, `tile_1_city_state`, and `tile_1_sf_ac`. This template has no price or status fields — that is expected (templates have variable field sets).

Verify the file exists at `templates/template-v2-test.indd`. Capture its size and last-modified time. Record this in `STAGE-3-NOTES.md` under a new section "Stage 3.1 — Template prep."

Commit as `docs: stage 3.1 template prep recorded`.

Proceed to 3.2.

---

## Stage 3.2 — Frame verification (smoke test)

Confirm the plugin can find each named frame before any render is attempted.

> **Action required:** I need to check the named frames work before rendering anything.
>
> 1. Start the bridge: `cd bridge && node server.js` — leave it running
> 2. Open InDesign 2024+
> 3. Load the plugin via UXP Developer Tool if it's not already loaded
> 4. Open the Bridge Panel — confirm the bridge log prints "Plugin connected"
> 5. Open `templates/template-v2-test.indd` in InDesign and make it the active document
>
> Reply when ready. I'll then give you a curl command to run.

Wait for the user to confirm.

Once they confirm, send them the appropriate curl command for their shell. Ask which they're using if unclear.

**PowerShell:**

```
curl -X POST http://127.0.0.1:3000/execute `
  -H "Content-Type: application/json" `
  -d '{\"code\": \"const doc = app.activeDocument; const names = [\\\"tile_1_photo\\\", \\\"tile_1_address\\\", \\\"tile_1_city_state\\\", \\\"tile_1_sf_ac\\\"]; const result = {}; for (const n of names) { const t = doc.textFrames.itemByName(n); const r = doc.rectangles.itemByName(n); result[n] = { text: t.isValid, rectangle: r.isValid }; } return { document: doc.name, frames: result };\"}'
```

**Bash (macOS / Linux / WSL):**

```
curl -X POST http://127.0.0.1:3000/execute \
  -H "Content-Type: application/json" \
  -d '{"code": "const doc = app.activeDocument; const names = [\"tile_1_photo\", \"tile_1_address\", \"tile_1_city_state\", \"tile_1_sf_ac\"]; const result = {}; for (const n of names) { const t = doc.textFrames.itemByName(n); const r = doc.rectangles.itemByName(n); result[n] = { text: t.isValid, rectangle: r.isValid }; } return { document: doc.name, frames: result };"}'
```

Tell them: "Run this and paste the response."

Wait for the response.

When you receive it, verify:

- `tile_1_photo` returns `{ text: false, rectangle: true }`
- `tile_1_address`, `tile_1_city_state`, `tile_1_sf_ac` each return `{ text: true, rectangle: false }`
- `document` field equals `"template-v2-test.indd"`

If any frame returns `{ text: false, rectangle: false }`, the name is wrong or missing in InDesign. Stop, tell the user which frame, and ask them to fix the name in InDesign and re-run the curl.

If `tile_1_photo` returns `text: true`, they named a text frame instead of the rectangle. Stop and report.

If you get an HTTP error (500, 503), report the error verbatim and stop.

If verification passes cleanly, record the response in `STAGE-3-NOTES.md` under "Stage 3.2 — Frame verification." Commit as `docs: stage 3.2 frame verification passed`.

Proceed to 3.3.

---

## Stage 3.3 — Mock comp and image preparation

Check whether `mock-data/comps.json` and `mock-data/images/` exist. Report what you find.

If `mock-data/comps.json` already exists with usable entries, list the entries (ID and address) and ask the user which one to use for this first render.

If neither exists, create the directory structure but stop before populating data:

> **Action required:** I need one mock comp and one image to render.
>
> 1. Pick one comp from your Crexi data — preferably a closed deal with a clean aerial drone photo
> 2. Create `mock-data/comps.json` with at least this entry, in this shape:
>
> ```json
> [
>   {
>     "id": "mock-1",
>     "address": "1501 W Knudsen Dr",
>     "city": "Phoenix",
>     "state": "AZ",
>     "building_sf": 89440,
>     "land_area": 32.52,
>     "image_filename": "1501-knudsen.jpg"
>   }
> ]
> ```
>
> 3. Save the corresponding image as `mock-data/images/<filename>` (matching `image_filename` above)
> 4. Reply when done.

Wait for confirmation.

When they confirm, verify:

- `mock-data/comps.json` exists and parses as valid JSON with at least one entry
- The image file referenced by the chosen entry's `image_filename` exists in `mock-data/images/` and is larger than 10 KB

If either check fails, report what's wrong and ask the user to fix.

Ask: "Should I commit `mock-data/comps.json` and the images, or are they test-only and should stay untracked?"

Wait for the answer. If commit, add them and record the chosen comp in `STAGE-3-NOTES.md`. If not, just record what was prepared. Either way, commit notes as `docs: stage 3.3 mock data prep`.

Proceed to 3.4.

---

## Stage 3.4 — Render script

Create `test-render.js` at the repo root. The script must:

1. Read `mock-data/comps.json` and use the first entry, or the entry matching `--id <id>` if provided as a CLI argument.
2. Resolve all paths with `path.resolve` — the bridge has path-traversal protection that rejects relative or `..` paths.
3. POST a sequence of operations to `http://127.0.0.1:3000/execute`. For each, log the step name and elapsed time.
4. The operation sequence:
   - Confirm `app.activeDocument.name` matches `template-v2-test.indd`. Throw if not.
   - Set `tile_1_address` text frame contents to the comp's address.
   - Set `tile_1_city_state` text frame contents to `"{city}, {state}"`.
   - Set `tile_1_sf_ac` text frame contents to `"±{building_sf with thousand-separator commas} SF | ±{land_area to 2 decimal places} AC"`. Example: `"±89,440 SF | ±32.52 AC"`.
   - Place the image into `tile_1_photo` rectangle frame using `FitOptions.FILL_PROPORTIONALLY`. The image path must be absolute and within the bridge's `INDESIGN_ALLOWED_ROOTS`.
   - Export to `output/test-render.pdf`. Create the `output/` directory if it doesn't exist.
5. Do NOT close the document at the end — leave it open in InDesign so the user can inspect it before deciding to close.
6. Print the final PDF path on success. Exit with code 1 on any error.

After writing the script, do not run it yet.

> **Action required:** Pre-flight check before running the render.
>
> 1. Confirm `INDESIGN_ALLOWED_ROOTS` is set in the bridge's environment to include the template path and the output path. If not, set it and restart the bridge.
> 2. Confirm the bridge is still running and the plugin is still connected (check the bridge log).
> 3. Confirm `template-v2-test.indd` is still the active document in InDesign with no edits since 3.2.
>
> Reply when ready and I'll run the script.

Wait for confirmation.

When confirmed, run `node test-render.js`. Capture stdout and stderr.

Verify execution:

- Script completes without error
- `output/test-render.pdf` exists and is larger than 50 KB
- Each step logs in single-digit seconds
- Total render time under 30 seconds

If any step fails, stop and report:

- The exact error message
- Which step failed
- Whether the document state in InDesign looks partially populated (ask the user to glance)

Do NOT debug autonomously beyond obvious typos in your own script. Surface the error and ask.

Record the run in `STAGE-3-NOTES.md`. Commit `test-render.js` and notes as `feat: stage 3.4 first render script`.

Proceed to 3.5.

---

## Stage 3.5 — Visual verification

The PDF exists. Now we find out if it actually looks right.

> **Action required:** Visual inspection of the rendered PDF.
>
> 1. Open `output/test-render.pdf` in any PDF viewer (Preview, Acrobat, browser — whatever)
> 2. Look at tile 1 specifically (the tile where you named the four frames)
> 3. Tell me what you see for each:
>    - Address: correct text? Right font? Anything off?
>    - City/state: correct format?
>    - SF/AC line: number formatting correct? Both values present?
>    - Photo: placed in the right frame? Cropped/fit correctly? Or stretched/letterboxed?
> 4. Tell me how the rest of tile 1 (and tiles 2-12) look — same as before? Anything inadvertently changed?
> 5. Optional: open Hannah's original template (the one you saved a copy from) and compare side by side. The four populated fields should match the mock data; everything else should be untouched.
>
> Reply with your findings.

Wait for the user's report. Do not assume anything visual without their confirmation.

Document the findings verbatim in `STAGE-3-NOTES.md` under "Stage 3.5 — Visual verification." Don't editorialize.

If issues are reported:

- "Text overflows the frame" → frame too small for content; document for follow-up
- "Numbers are wrong format" → script formatting bug; ask the user if they want a quick fix attempt
- "Photo is letterboxed" → wrong FitOptions; we used FILL_PROPORTIONALLY but maybe should be different — ask
- "Other tiles changed" → something is wrong with the template or the script touched something it shouldn't; stop and triage

If the user reports it all looks right, commit the notes as `docs: stage 3.5 visual verification passed`.

Proceed to 3.6.

---

## Stage 3.6 — Stage 3 wrap-up

If 3.5 passed cleanly, do the following:

1. Add a one-page Stage 3 summary to `STAGE-3-NOTES.md`. Include:
   - Sub-stages completed
   - Frame verification result
   - Mock comp used
   - Render time
   - Visual verification outcome (verbatim quote from user)
   - Commits added in Stage 3
   - Anything to flag for Stage 4 (e.g., "FILL_PROPORTIONALLY confirmed correct for aerial photos")

2. Tag the current commit as `stage-3-complete`:

   ```
   git tag stage-3-complete
   ```

   Ask the user before pushing the tag — they may be working on a private fork.

3. Commit any final notes as `docs: stage 3 complete`.

4. Print a closing summary:
   - Total commits added in Stage 3
   - Tag created (and whether pushed)
   - Stage 4 prerequisites that are now met
   - Any open items the user needs to address before Stage 4

5. Stop. Do not begin Stage 4 work.

If 3.5 surfaced issues that haven't been resolved, do NOT close Stage 3. Document open items in `STAGE-3-NOTES.md` and ask the user how to proceed. Stage 3 is only complete when one tile renders cleanly through the real template.

---

## Working notes

- Cite file paths and commit hashes throughout. Make it traceable.
- Don't run `git push` without confirming with the user.
- Don't modify Hannah's original template file. Only ever touch `template-v2-test.indd`.
- If the user says "stop" at any point, stop. Don't try to finish a step they paused.

## When you're done

Print a 3-line summary:

- Stage 3 status (complete / blocked / pending user input)
- One-tile render: works / has issues
- Recommendation: ready for Stage 4 / needs iteration on template or script

Then stop.