# BOV templates

Placeholder. The BOV workflow is in scoping — no production BOV
templates exist yet.

When the first BOV template arrives:

1. Drop its `.indd` into `TEMPLATES_DIR` (the directory pointed to by
   the env var; not the repo).
2. Create `template-manifests/bov/<TemplateName>/manifest.json` using
   the shape documented in [../README.md](../README.md).
3. Restart the render service.

Once the BOV backend code lands under `render-service/bov/` and BOV
routes mount at `/bov/*`, the new manifest will be discoverable by
the BOV-side endpoints without further config.
