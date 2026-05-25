# Backend Restructure — Implementation (gate items before BOV)

**Role:** You are an implementation agent working **only** in the `indesign-uxp-server` repo. You make
real changes here. Do **not** modify, read, or touch the `master-app` repo at all — but everything you
do must preserve master-app's live integration exactly (see the **"Master-app compatibility"** section,
which is the non-negotiable acceptance bar).

**Read first:** `backend-consolidation-analysis.md` in this repo. It is the blueprint. This prompt
implements its gate items (its "Ordered next steps" 1, 3, 4) plus the templates-out-of-repo decision
the user has since made. Where this prompt and the analysis differ, **this prompt wins** (notably on
templates: they go OUT of the repo, not into it).

---

## Why this work exists

The team-sheet workflow is split clean (frontend in master-app, backend here). BOV will follow the
same split and its backend lives here too. Before BOV starts, restructure the backend so team-sheet
and BOV code are physically separated and can never entangle, and so templates/manifests are stored
sensibly. BOV has not started — `bov/` is a stub in this pass. **Do not build any BOV logic.**

This is a structural refactor. It must be behavior-preserving: the running service does exactly what
it does today, just organized differently and reading templates from a new location.

**The end state must satisfy three things at once:**
1. **BOV-ready** — the `core/ + teamsheet/ + bov` seam is in place so BOV backend code drops into
   `bov/` later as a pure addition, reusing `core/`, never touching `teamsheet/`, and attaches at the
   reserved `/bov/*` mount with zero changes to team-sheet behavior.
2. **Commit-and-push ready** — the repo is clean to commit to Max's GitHub (no secrets, no templates,
   no `node_modules`, no machine-specific cruft; manifests and source present).
3. **Clone-and-run ready** — a fresh clone on the on-prem Mac boots with only `npm install` + env from
   `.env.example` + templates dropped into `TEMPLATES_DIR`. (See "Clone-and-run readiness" below.)

---

## What to change

### 1. Manifests INTO the repo
- Move the template manifests out of `dashboard/templates/` to a repo-level directory
  **`template-manifests/`** (keep the `team-sheets/` and `bov/` subfolder structure; `bov/` stays
  empty).
- Use `git mv` so history is preserved.
- These are small JSON files and **are committed to the repo.**

### 2. Templates OUT of the repo (env-var path)
- The `.indd` template files are large (~200 MB) and **must not go into git** (exceeds GitHub's 100 MB
  per-file hard limit). They live in a **stable directory outside the repo**, addressed by an env var.
- Introduce/confirm an env var — name it **`TEMPLATES_DIR`** — that points to that directory. Default
  it for local dev to wherever the `.indd` files currently resolve today (check `config.js` /
  `INDESIGN_REPO_ROOT` usage), but it must be overridable and must resolve to a path **outside** the
  repo tree so `git pull` never touches it.
- Each manifest references its template by **filename**; the service resolves the actual file as
  `TEMPLATES_DIR + <filename>`. Make this resolution explicit and centralized (one helper), not
  scattered.
- Ensure `.gitignore` keeps `.indd` files ignored (they're out-of-repo anyway, but make sure no stray
  template gets committed), and keep `templates/working/` (the per-render scratch copies) ignored as
  it is today. **Do not relax `.gitignore` broadly** — be surgical; never sweep in `.env` or
  `node_modules`.
- Update `render-service/.env.example` to document `TEMPLATES_DIR` and the manifest dir clearly.

> **Operational model this enables (document it in the README):** a normal update is `git pull` +
> restart (brings code + manifests). A template add/change is: drop the `.indd` into `TEMPLATES_DIR`
> + restart. A new template needs BOTH its `.indd` (dropped into `TEMPLATES_DIR`) AND its manifest
> (committed in `template-manifests/`, arrives via `git pull`) — the `.indd` alone won't register
> without a manifest. State these two update paths explicitly.

### 3. Restructure `render-service/` into `core/ + teamsheet/ + bov/`
Follow the analysis §4.4 layout. Use `git mv` and update import paths inside each moved file.

- **`core/`** (shared substrate, no workflow knowledge): `bridge-client.js`, `supabase.js`,
  `manifest.js`, `images.js`, `render-script.mjs`, `template-introspect.js`, `auth.js`, `comps.js`.
- **`teamsheet/`** (team-sheet-specific): `tile-builder.js`, `format.js`, `merge-overrides.js`,
  `validate.js`, `render-pipeline.js` (you may rename to `teamsheet-pipeline.js`), and a
  `teamsheet/routes/` holding `render.js`, `introspect.js`, `page-fields.js`.
- **`bov/`** (stub only): a `README.md` saying "BOV-specific render code lands here; do not put
  team-sheet code or shared substrate here," and an empty `bov/routes/`. **No BOV code.**
- **`routes/`** (workflow-agnostic, stays at top): `status.js`, `preview.js`.
- `config.js` stays shared at the service root.
- Wire `server.js` to mount: the flat workflow-agnostic routes (`/status`, `/preview`), the team-sheet
  routes at their **current flat paths** (see compatibility section), and leave a clearly-commented
  mount point where `/bov/*` routes will attach later.

### 4. API paths — keep team-sheet FLAT, reserve `/bov/*`
- **Do not rename or move any team-sheet endpoint.** They stay exactly as master-app calls them today:
  `/render`, `/introspect`, `/page-fields`, `/preview`, `/status`. (Internally these may be served by
  files now living under `teamsheet/routes/`, but the **external paths must not change.**)
- Add nothing under `/bov/*` yet — just reserve it with a commented mount point in `server.js` and the
  `bov/` stub. BOV will get its own endpoints later and master-app will wire to them separately.

---

## Master-app compatibility (NON-NEGOTIABLE — the core acceptance bar)

Master-app's team-sheet integration is **live in production** and calls this service. This refactor
must be **completely invisible** to it. Concretely:

- **Every existing endpoint keeps its exact path, HTTP method, request shape, response shape, status
  codes, and headers.** `/render` still takes `{ template_id, comp_ids[], page_overrides, tile_overrides? }`
  and still returns the `application/pdf` byte stream with the same `X-Render-*` headers. `/introspect`,
  `/page-fields`, `/preview`, `/status` likewise unchanged on the wire.
- **No change to auth behavior** — the `SERVICE_TOKEN` seam stays as-is (off by default locally;
  `Authorization: Bearer` honored when set). Master-app's proxy already sends this conditionally.
- The internal reorganization (files moving into `core/teamsheet/`) and the template-path change
  (`TEMPLATES_DIR`) must produce **byte-for-byte equivalent behavior** for the same inputs. Moving a
  template's storage location must not change what `/render` or `/introspect` return for that template.
- If anything about the external contract would have to change to make the refactor work, **stop and
  flag it** rather than changing the contract. The contract is fixed; the internals bend around it.

Treat "master-app continues to work with zero changes on its side" as the definition of done for the
API portion. You do not touch master-app; you guarantee it never needs touching.

---

## Clone-and-run readiness (the on-prem deploy target)

The end state of this pass must be a repo that can be **committed, pushed to Max's GitHub, then
cloned fresh onto the on-prem Mac and started** — with only templates dropped in and env values set.
A refactor that passes tests on *this* machine but won't boot on a clean clone is not done. Guarantee
all of the following:

- **A fresh clone contains everything in-repo that's needed to run, except the three intentionally
  external things:** (a) `node_modules` (restored via `npm install`), (b) the `.indd` templates (dropped
  into `TEMPLATES_DIR`), (c) secrets/config (set from `.env.example`). Nothing else may be required that
  isn't in the repo. No file that lives only on the current machine and is silently depended on.
- **No absolute paths, no machine-specific paths, no developer-home paths** anywhere in committed code
  or config. Everything resolves from the repo root or from env vars. Audit for hardcoded paths and
  remove them.
- **`.env.example` is complete and accurate** — every env var the service actually reads is listed,
  documented, with safe defaults where sensible and clear placeholders where a real value is required
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEMPLATES_DIR`, manifest dir, `BRIDGE_URL`, `PORT`,
  `SERVICE_TOKEN`, `INDESIGN_REPO_ROOT` if still used). A new operator must be able to create a working
  `.env` from `.env.example` alone.
- **Dependencies install cleanly from a clean state** — `npm install` in `bridge/` and in
  `render-service/` succeeds from nothing (lockfiles committed, no globally-assumed packages). Confirm
  by reasoning about what a fresh checkout has.
- **Start commands are documented and work from a clean clone** — the exact sequence (install, set env,
  start bridge, start render service, load plugin) is in the README and accurate.
- **`.gitignore` is correct in both directions** — it excludes `node_modules`, `.env`, `.indd`,
  `templates/working/`, `output/`, and any local scratch; and it does NOT exclude anything the clone
  needs (manifests, source, `.env.example`, lockfiles, the `bov/` stub).
- **The repo root is coherent for a new reader** — don't do the full "after BOV" cleanup, but ensure
  nothing committed actively misleads a fresh operator about how to run the backend (if the stale root
  `package.json` / `index.js` would misdirect someone cloning to run the backend, note it prominently
  in the README's run section rather than leaving them to trip on it; actual deletion stays a later task).

This does not mean set up launchd / tunnel / auto-login here — that's the separate ops runbook. It
means: the *repository itself* is in a state where `git clone` + `npm install` + set env + drop
templates + start = a working backend, with no hidden local dependencies.

---

## Hard rules

1. Work only in `indesign-uxp-server`. Do not read or modify `master-app`.
2. Behavior-preserving refactor — no feature changes, no contract changes, no BOV logic.
3. Use `git mv` for moves so history survives. Update all import paths the moves break.
4. Templates stay OUT of git; manifests go INTO git. Be surgical with `.gitignore` — never commit
   `.indd`, `.env`, or `node_modules`.
5. Do not retire the dashboard, delete the old MCP-server `src/`, or do any of the analysis's
   "after BOV" cleanup steps. This pass is only the gate items + templates decision.
6. Commit in small, reviewable steps with clear messages. Note a restore point (tag/branch) before
   starting so the pre-refactor state is recoverable.
7. Keep secrets in env; redact in any logs/report.

---

## Test plan (must pass before done)

Prereqs running: InDesign + UXP plugin connected, bridge (3000/3001) up, render service (8765) up,
`TEMPLATES_DIR` pointing at the relocated `.indd` files, manifests in `template-manifests/`, Supabase
env set.

1. **Service boots** cleanly after the restructure (no broken imports).
2. **`/status`** → `{ connected: true, queueDepth: 0 }`.
3. **`/introspect`** for `6_Tile_Defaults` → `tileCount 6`; `18_Tile_Price_Status` → 18. Identical
   responses to pre-refactor.
4. **`/page-fields`** → same fields/values as before; empty-case short-circuit intact.
5. **`/preview`** → valid inline PDF.
6. **`/render`** with ordered `comp_ids` + `page_overrides` → valid PDF, correct comps in correct tile
   order, overrides applied, `X-Render-*` headers present. Byte-equivalent behavior to pre-refactor.
7. **Template resolution from `TEMPLATES_DIR`** — confirm the service finds and renders templates from
   the out-of-repo path, and that a fresh `git pull`-style checkout (no `.indd` in it) plus templates
   dropped into `TEMPLATES_DIR` renders successfully.
8. **Re-run the full `render-service/README.md` curl plan** — every check passes unchanged.
9. **Clean-clone readiness check (reason it through, don't skip):** verify that a fresh `git clone`
   of the post-refactor repo would boot with only `npm install` + `.env` from `.env.example` +
   templates dropped into `TEMPLATES_DIR`. Specifically confirm: no committed absolute/machine-specific
   paths; `.env.example` lists every var the code reads; lockfiles committed; `.gitignore` excludes
   `node_modules`/`.env`/`.indd`/`templates/working/`/`output/` but includes manifests, source,
   `.env.example`, and the `bov/` stub. Document the exact clean-clone start sequence in the report.
10. **Master-app smoke test (manual, user-run):** the user will open the live/local master-app Team
   Sheet flow and generate a sheet end-to-end against the restructured service, confirming zero
   behavior change. Leave clear instructions for this in the report; do not attempt it yourself.

---

## Deliverables

1. Restructured `render-service/` (`core/ + teamsheet/ + bov` stub + flat `routes/`), imports fixed,
   `server.js` wiring the flat team-sheet paths and a reserved `/bov/*` mount point.
2. Manifests in `template-manifests/` (committed); templates resolved from `TEMPLATES_DIR` (out of
   repo); `.gitignore` and `.env.example` updated accordingly.
3. README updates: the new structure, the `TEMPLATES_DIR` model, and the **two update paths**
   (code/manifest via `git pull`; template via drop-in), plus the new-template "needs both .indd and
   manifest" note.
4. A `restructure-report.md`: what moved where, the final structure, confirmation that no external API
   path/contract changed (with the endpoint list before/after to prove it), the template-resolution
   change, the curl results, the **clean-clone start sequence and readiness confirmation** (the exact
   commands to clone, install, configure, drop templates, and start on a fresh Mac), and explicit
   step-by-step instructions for the user's master-app smoke test.

End with the curl plan passing and the report written. Master-app must require zero changes. Do not
build BOV. Do not run the cleanup steps.