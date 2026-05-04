# STAGE 4 NOTES

Standalone Next.js dashboard around the Stage 3 batched render pipeline.
Goal: get Hannah a usable web UI for picking 6 comps, hitting render, and
previewing the resulting PDF.

Companion to `STAGE-2-NOTES.md` and `STAGE-3-NOTES.md`. Same structure:
each sub-stage records what was done, key decisions, and anything worth
flagging for the post-Hannah review (Liam → Jon → Max).

---

## Prerequisites — verified at start

- `STAGE-3-NOTES.md` exists at repo root
- Tag `stage-3-complete` exists locally and on `origin`
- Tag `stage-3.7-complete` exists locally (batched multi-tile render)
- `templates/template-v2-test.indd` exists (~14 MB)
- `test-render.js` is the Stage 3.7 batched version
- `mock-data/comps.json` has 7 entries, each with a referenced image
- Working tree clean of unstaged changes (only intentional untracked
  files: `analysis/safety-report.md`, various `*prompt.md`, `.claude/`)
- Tooling: node 24.11.1, npm 11.12.0, pnpm 10.33.2 (resolved via
  corepack)

---

## Stage 4.1 — Scaffold dashboard

### Tooling decision

The Stage 4 prompt's two instructions ("use pnpm if available, otherwise
npm" and "match what the user has been using in `bridge/`") conflict —
the bridge uses npm. Picked **pnpm**: it's available via corepack, the
prompt's `create-next-app` example uses `--use-pnpm`, and the dashboard
is a separate app from the bridge so the package-manager choice doesn't
need to match.

### Scaffold

```
$ npx --yes create-next-app@latest dashboard \
    --typescript --tailwind --app --no-src-dir --no-eslint \
    --use-pnpm --no-turbopack --import-alias "@/*"
...
+ next 16.2.4
+ react 19.2.4
+ tailwindcss 4.2.4
+ typescript 5.9.3
```

Note: `--no-turbopack` was passed at scaffold time, but Next.js 16's
`next dev` uses Turbopack by default anyway (visible in the dev server
banner: `▲ Next.js 16.2.4 (Turbopack)`). Not a problem; just noted so
future readers don't expect a Webpack runtime.

### shadcn/ui init

```
$ npx --yes shadcn@latest init --defaults --force
✔ Verifying framework. Found Next.js.
✔ Validating Tailwind CSS. Found v4.
✔ Writing components.json.
✔ Created 2 files: components/ui/button.tsx, lib/utils.ts
✔ Updating app/globals.css
```

Default preset (= `next` + `base-nova`) added a Button component
during init. The other 5 components added explicitly:

```
$ npx --yes shadcn@latest add input card select label separator --yes
✔ Created 5 files:
  - components/ui/input.tsx
  - components/ui/card.tsx
  - components/ui/select.tsx
  - components/ui/label.tsx
  - components/ui/separator.tsx
```

Components ready: `button`, `input`, `card`, `select`, `label`,
`separator` — exactly the set the Stage 4 prompt asked for.

### Port: 4000 (not 3000)

The bridge owns `127.0.0.1:3000`. The dashboard runs on `:4000` to
avoid the conflict — patched in `dashboard/package.json`:

```json
"dev":   "next dev --port 4000",
"start": "next start --port 4000"
```

(Skipped the prompt's "confirm on default 3000 first, then change to
4000" cycle because the bridge would have collided with port 3000 the
moment the dashboard started — direct path to 4000 is cleaner.)

### Turbopack workspace root

Turbopack auto-detected the repo root (`E:\TAI\indesign-uxp-server\`)
as the workspace root because the MCP server's `package-lock.json`
lives there. That surfaced a warning and risked confused module
resolution. Pinned the workspace root to the dashboard folder via
`dashboard/next.config.ts`:

```ts
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
    turbopack: {
        root: here,
    },
};
```

Warning gone after restart.

### Layout + page

`app/layout.tsx`: replaced the create-next-app default metadata with
`title: "Team Sheet Renderer"` and a one-line description. Body is a
minimal `<body>` with bg/text foreground classes — no header chrome,
no sidebar, per the Stage 4 prompt's "title only" instruction.

`app/page.tsx`: replaced the create-next-app marketing splash with a
minimal Stage-4.1 placeholder:

```tsx
export default function Home() {
    return (
        <main className="mx-auto max-w-5xl px-6 py-10">
            <h1 className="text-2xl font-semibold tracking-tight">
                Team Sheet Renderer
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
                Stage 4.1 scaffold. Comp picker and render UI come in Stage 4.3.
            </p>
        </main>
    );
}
```

### AGENTS.md / CLAUDE.md from create-next-app

`create-next-app` generated `dashboard/AGENTS.md` and `dashboard/CLAUDE.md`
that direct AI agents to read `node_modules/next/dist/docs/` (the
version-matched Next.js 16 docs that ship with the package) before
writing any Next.js code. Their existence is intentional and they're
committed.

I read the relevant docs (layouts-and-pages, ai-agents) before
writing this scaffold. Will read the docs for route handlers (Stage
4.2) and server/client components (Stage 4.3) before those stages.

### Verification

Dev server boot log:

```
▲ Next.js 16.2.4 (Turbopack)
- Local:   http://localhost:4000
✓ Ready in 667ms
```

`curl http://localhost:4000` → HTTP 200 in 1.85 s on first compile.
Page contains both `Team Sheet Renderer` heading and the placeholder
text; `<title>` matches.

Human visual confirmation: "Looks perfect, we shall continue."

### Stage 4.1 status: pass

---
