# `indesign-uxp-server` — Backend Consolidation & BOV-Readiness Analysis

**Role:** You are a read-only analysis agent working **only** in the `indesign-uxp-server` repo. You
**do not modify, refactor, move, or delete anything.** Your sole output is a markdown **decision
report** that recommends what to keep, what to retire, and how to structure the repo so that future
BOV backend work slots in cleanly alongside the existing team-sheet backend. A human reviews your
report and a *later* implementation pass acts on it. Do not implement anything now.

Do not read or analyze the `master-app` repo. If you need to reference the contract master-app calls,
read only `render-service/README.md` within this repo.

---

## Context (why this analysis exists)

This repo has grown through several phases:
- A bridge (`bridge/`, HTTP 3000 + WS 3001) that drives the InDesign UXP plugin.
- A UXP plugin (`plugin/`) inside InDesign.
- A standalone **render service** (`render-service/`, port 8765) created in Phase 1, which is the
  production backend — it will be deployed to an always-on Mac, sit behind a Tailscale Funnel, and
  be called by master-app (cloud) over the tunnel.
- A **Next.js dashboard** (`dashboard/`) — the original UI, since superseded by the team-sheet UI
  that now lives in master-app. The dashboard was kept as a local test client.
- Templates, manifests, mock data, scripts, and per-phase reports.

The team-sheet workflow is now split clean: **frontend in master-app, backend here.** BOV will follow
the **same split** — BOV frontend will go in master-app (its own tab, not yet started), BOV backend
will live **here**, alongside the team-sheet backend.

**The problem to solve:** before any BOV work begins, establish a clear, durable boundary so that:
1. The production backend is unambiguous — what actually ships to Max's git and runs on the Mac.
2. Superseded/scaffolding code (notably the old `dashboard/`) is identified so it can be retired or
   quarantined, not accidentally shipped or maintained.
3. The repo is structured so **BOV backend code and team-sheet backend code are cleanly separable** —
   shared render substrate shared deliberately, workflow-specific logic kept apart — so the two never
   entangle as BOV grows.

This report is the blueprint for that boundary. BOV has not started, so this is the moment to get the
structure right with no migration cost.

---

## What to investigate and decide

### A. What is the production backend, exactly?
- Inventory everything the deployed Mac actually needs to run team-sheet renders end to end: the
  render service, the bridge, the plugin, templates, manifests, shared InDesign-side code
  (`render-script.mjs` and anything it depends on), config/env.
- For each, state: **keep (production)**, and why it's required at runtime.
- Identify the exact runtime entry points and how they start (so the deploy/launchd setup is unambiguous).

### B. What is scaffolding / superseded / test-only?
- Classify the `dashboard/` (Next.js UI): is any part of it still required by the production backend,
  or is it now fully superseded by the master-app UI? Check carefully whether the render service or
  bridge import anything from `dashboard/` (Phase 1 may have left shared modules there, e.g. the
  `Comp` type, Supabase access, `render-script.mjs`, formatters). **Anything the production backend
  imports from `dashboard/` is a problem to flag** — production code should not depend on a UI folder
  that's slated for retirement.
- Classify test scripts, mock data, one-off utilities, and the per-phase report files: keep / archive
  / safe-to-remove. Don't delete — recommend.
- Be explicit about anything ambiguous: if you can't tell whether something is still load-bearing, say
  so and show the evidence (who imports it).

### C. Shared substrate vs workflow-specific — the BOV-readiness core
This is the most important section. Determine the seam between:
- **Shared render substrate** — the parts that BOTH team sheets and BOV will use: the bridge, the
  plugin, the InDesign-side render/execute mechanism, template-introspection, image fetch/place,
  PDF export, the queue/concurrency handling, the service HTTP layer, auth (`SERVICE_TOKEN`), config.
- **Team-sheet-specific logic** — the parts unique to team sheets: the tile-field mapping
  (`resolveTileFieldValue` and the hardcoded `address|city_state|sf_ac|price|status|photo` set), the
  team-sheet render contract (ordered `comp_ids` + `page_overrides`), team-sheet templates/manifests.
- Then describe **where BOV-specific logic would live** by analogy: BOV will have its own templates,
  its own field/section mapping (far more complex — pricing tables, exec summary, sold-comps table,
  maps, brag-sheet tiles, per the BOV structure), and likely its own render contract. It must reuse
  the shared substrate without forking it.

Produce a recommended repo structure that makes this seam explicit — e.g. a shared core module plus
per-workflow modules (`teamsheet/`, `bov/`) — so BOV backend work is additive and isolated. Show the
proposed layout and map current files into it. **Recommend only; do not move anything.**

### D. The render service's API shape for two workflows
- Today the service exposes team-sheet-oriented endpoints (`/render`, `/introspect`, `/page-fields`,
  `/preview`, `/status`). Recommend how the API should accommodate a second workflow: namespaced
  routes (`/teamsheet/render` + `/bov/render`), a workflow parameter, or separate route groups.
- Whichever you recommend, it must not break the existing contract master-app already calls
  (`render-service/README.md`). State explicitly how to add BOV without a breaking change to the
  team-sheet contract — master-app's team-sheet integration is live and must keep working.

### E. Deployment & update implications
- The backend will be cloned to Max's git and pulled+restarted on the Mac for updates (including the
  future BOV update). Flag anything in the current structure that would make "pull + restart" unsafe
  or ambiguous — e.g. build steps required before run, uncommitted local config, files that must
  exist outside the repo (templates in a secure dir), env vars that must be set.
- Note what should be `.gitignore`d / kept out of the repo (secrets, local output, working dirs,
  `node_modules`) and what must be present for a clean clone to run.
- Confirm whether the production backend has any dependency on `dashboard/` that would force shipping
  the dashboard to production (it should not) — and if so, flag it as the top thing to fix before
  BOV.

---

## Hard rules

1. **Read-only.** No edits, no moves, no deletes, no new files except the report. Recommend; don't act.
2. Stay in `indesign-uxp-server`. Do not read `master-app` (except this repo's `render-service/README.md`).
3. **Cite evidence** — every "keep/retire/shared/specific" call references file paths (and import
   sites where relevant). The dashboard-dependency question especially must be answered with actual
   import evidence, not assumption.
4. **Don't guess.** If load-bearing status is unclear, say "undetermined — here's what I checked."
5. Redact any secrets/tokens/credentials you encounter; report that they exist and where.
6. Do not propose anything BOV-*frontend* — that's master-app's concern. This is backend structure only.

---

## Required report structure

Write `backend-consolidation-analysis.md` (in this repo, non-destructive path):

1. **Executive recommendation (top, one section):** the proposed clean boundary in a paragraph —
   what the production backend is, what gets retired/quarantined, and the one-line shape of the
   team-sheet/BOV separation. Lead with this.
2. **Production backend inventory (§A)** — keep-list with runtime justification and entry points.
3. **Scaffolding / superseded (§B)** — classification table (keep / archive / safe-to-remove), with
   the dashboard-dependency finding called out prominently.
4. **Shared vs workflow-specific seam (§C)** — the substrate/team-sheet/BOV breakdown, the proposed
   repo structure, and a mapping of current files into it.
5. **API shape for two workflows (§D)** — the recommended routing approach and how it stays
   backward-compatible with the live team-sheet contract.
6. **Deployment & update readiness (§E)** — pull+restart safety, gitignore/keep lists, the
   no-dashboard-in-production confirmation.
7. **Risks & open items** — anything ambiguous, anything a human must decide, anything that should be
   fixed *before* BOV work starts vs. deferred.
8. **Ordered next steps** — the concrete sequence of changes a later implementation pass should make
   to realize the recommended boundary (still without entangling BOV), each phrased so it can become
   its own scoped task.

End with a short stdout summary: production-backend file count, whether the production backend
currently imports from `dashboard/` (yes/no — the key finding), and the proposed top-level structure
for team-sheet/BOV separation.

Do not implement. This run ends with the report.