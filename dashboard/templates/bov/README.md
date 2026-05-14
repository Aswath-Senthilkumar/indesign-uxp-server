# BOV templates

Placeholder. The BOV workflow is in scoping — the dashboard's workflow
picker shows it as "Coming soon" and the card is non-interactive.

When the first BOV template arrives:

1. Drop its `.indd` into `templates/` at the repo root.
2. Create `dashboard/templates/bov/<TemplateName>/manifest.json` here
   using the shape documented in
   [../README.md](../README.md).
3. Flip `WORKFLOWS.bov.available` to `true` in
   [../../lib/workflows.ts](../../lib/workflows.ts).
4. Restart the dev server.

The workflow picker filters its template list by workflow path, so the
new BOV template will appear only after picking "BOV" on
`/build/workflow`. The 6-tile / 18-tile team-sheet templates are
unaffected.

Anticipated BOV-specific work that is **not** yet built (deferred from
Stage 8 planning until the template exists):

- **Page duplication.** BOV is a single template layout repeated across
  N pages, each populated with a different comp set. The bridge code
  in [../../lib/render-script.mjs](../../lib/render-script.mjs) needs
  to either duplicate pages at render time or have the manifest declare
  a fixed page count up front.
- **Per-page comp grouping.** The current comps picker selects one
  flat list of N comps and the edit page reorders them onto N tiles.
  BOV needs either (a) one pool divided across pages, or (b) explicit
  per-page comp selection — TBD.
- **BOV-only page-level fields.** Subject property address, valuation
  summary, cover-page copy, etc.
- **Per-page frame scoping in the bridge.** Today the bridge looks up
  frames globally by name across the whole document. For page-duplicated
  templates the lookup may need to be page-scoped so each page's
  `tile_N_address` references the correct page's frame.
