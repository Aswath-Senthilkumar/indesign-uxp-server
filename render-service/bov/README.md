# `render-service/bov/`

Stub. BOV-specific render code lands here when BOV development starts.

## What goes here

- BOV-specific request validators (BOV's input shape isn't `comp_ids[]`
  — it's a richer per-section / variant-selection payload, TBD).
- BOV-specific field/section resolvers (BOV's equivalent of
  `teamsheet/tile-builder.js`'s `resolveTileFieldValue` switch, but
  for sections like `cover_subject_address`, `exec_strengths_opportunities`,
  `pricing_main_table`, `s2card_N_details`, etc.).
- BOV-specific formatters.
- A BOV render pipeline (orchestration of variant resolution,
  multi-section field resolution, broader image staging).
- Express routes under `bov/routes/`, mounted at `/bov/*` by
  `server.js` (the mount point is reserved with a comment in
  `server.js` today).

## What does NOT go here

- **Shared substrate** (bridge client, Supabase, manifest scanner,
  image fetch + cache, the bridge JS-string generator, template
  introspection, auth, comps reader, template-path helper). All of
  that lives in `../core/` and is imported.
- **Team-sheet code.** Anything specific to the
  `address|city_state|sf_ac|price|status|photo` field set or the
  `comp_ids[] + page_overrides + tile_overrides` request shape
  belongs in `../teamsheet/`.

## External API

BOV endpoints attach at `/bov/*` (e.g. `POST /bov/render`,
`POST /bov/introspect`, `GET /bov/sections?template_id=...`). Team-sheet
endpoints stay at their existing flat paths (`/render`, `/introspect`,
`/page-fields`, `/preview`, `/status`) — that contract is frozen and
master-app depends on it.
