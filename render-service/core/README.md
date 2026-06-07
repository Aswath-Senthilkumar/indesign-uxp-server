# render-service/core

Shared substrate for all render-service workflows. Modules here have **no workflow knowledge** — they provide the building blocks that `teamsheet/` and `bov/` import. Nothing team-sheet-specific or BOV-specific belongs here.

## Modules

### `bridge-client.js`
`bridgeExecute(code: string) → result`

Sends a JS code string to the bridge's `/execute` HTTP endpoint and returns the parsed result. Handles bridge connection errors and non-`ok` responses with actionable error messages. All workflow routes import this instead of talking to the bridge directly.

---

### `manifest.js`
Template registry — scanned once at startup.

- Walks `TEMPLATE_MANIFEST_DIR/<workflow>/<TemplateName>/manifest.json`
- Only processes folders matching the `WORKFLOW_IDS` set (`team-sheets`, `bov`)
- Validates schema (`id`, `label`, `file` are required)
- Exposes `getManifest(id)` and `listManifests()` — cached for process lifetime, restart to refresh
- **To add a workflow:** add its id to `WORKFLOW_IDS`, create the folder under `template-manifests/`, restart

---

### `template-paths.js`
`resolveTemplatePath(manifest) → absolutePath`

Single source of truth for `.indd` file location. Joins `TEMPLATES_DIR` + `manifest.file`. Called by every route that needs to open a template; throws a structured error if the file is missing, which surfaces as a `503` to the caller.

---

### `template-introspect.js`
`introspectTemplate(templatePath) → { pages, frames }`

Opens the template via the bridge (using `OpenOptions.openCopy` for isolation), reads its page count and all named frame names, then closes it. Results are cached in-memory per template path for the process lifetime.

---

### `comps.js`
`getComps() → Comp[]`

Reads all rows from the Supabase `comps` table. Server-side only — never called from the dashboard directly (the dashboard calls `/api/bov/comps` which calls this). Returns the full comp list; callers filter by id.

---

### `supabase.js`
Initialises and exports the Supabase JS client from `SUPABASE_URL` + `SUPABASE_ANON_KEY`. Imported by `comps.js` and any route that needs direct Supabase access.

---

### `images.js`
`fetchAndCacheImage(url) → Buffer`

Downloads an image from a remote URL (typically Supabase Storage) and caches the buffer in memory with a 5-minute TTL. Teamsheet tile rendering calls this for every comp with a non-null `image_url`. Cache hits avoid redundant fetches within a batch render session.

---

### `render-script.mjs`
`buildRenderScript(fields: {frame, value}[]) → codeString`

Field-agnostic bridge JS-string generator. Given an array of `{ frame, value }` pairs, produces the UXP script that calls `findItem(name)` for each frame and sets its `.contents`. Used by the teamsheet pipeline; BOV routes build their own more complex scripts directly.

---

### `auth.js`
`authMiddleware(req, res, next)`

Express middleware. When `SERVICE_TOKEN` env var is set, validates `Authorization: Bearer <token>` on incoming requests. `/status` is always bypassed. No-op when `SERVICE_TOKEN` is unset (local development default).

## Design rule

If a module is only needed for BOV → it goes in `../bov/`. If only for team sheets → `../teamsheet/`. If shared by both → it goes here.
