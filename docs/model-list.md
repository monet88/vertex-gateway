# Vertex Gateway — Model List

> Last verified: **2026-07-02** against Vertex AI with `location: global`.
> All models below require `location: "global"` — regional locations return
> 404 for most Gemini 3.x models.

---

## Text / Multimodal

| Model ID                 | Status | Notes                   |
| ------------------------ | ------ | ----------------------- |
| `gemini-3.5-flash`       | ✅     | **Recommended default** |
| `gemini-3.1-pro-preview` | ✅     |                         |
| `gemini-3.1-flash-lite`  | ✅     |                         |
| `gemini-2.5-flash`       | ✅     |                         |
| `gemini-2.5-flash-lite`  | ✅     |                         |
| `gemini-2.5-pro`         | ✅     |                         |

## Image Generation

| Model ID                         | Status | Notes                                                           |
| -------------------------------- | ------ | --------------------------------------------------------------- |
| `gemini-3.1-flash-image-preview` | ✅     | **Recommended default**. Used by custom routes & OpenAI surface |
| `gemini-3.1-flash-lite-image`    | ✅     | Lightweight variant. Works with express mode `global`           |
| `gemini-3-pro-image`             | ✅     |                                                                 |
| `gemini-3-pro-image-preview`     | ✅     |                                                                 |
| `gemini-2.5-flash-image`         | ⚠️     | Requires Service Account + explicit regional location (not express mode `global`) |

⚠️ `gemini-2.5-flash-image` does **not** work with express API key mode (`apiKey`)
because the SDK maps API keys to `asia-southeast1` where this model is unavailable.
Use a **Service Account** (`credentialsFile`) with an explicit regional location instead.

### OpenAI Image Surface Allowlist

The `/openai/v1/images/generations` endpoint enforces a **hardcoded allowlist**
(see `openai-images-routes.ts`):

```
gemini-2.5-flash-image
gemini-3.1-flash-image          (alias → gemini-3.1-flash-image-preview)
gemini-3.1-flash-image-preview
gemini-3.1-flash-lite-image
gemini-3-pro-image
gemini-3-pro-image-preview
```

Models not in this set → `400 VALIDATION_FAILED`.

### Custom Image Routes Default

`/api/images/*` routes default to `gemini-3.1-flash-image-preview` when no
model is specified (see `image-workloads.ts`).

---

## Model Aliases

Configured in `modelCatalog` within `pool-config.local.json`. These aliases
allow clients to use shorter names that resolve to actual model IDs.

| Alias                    | Resolves To                      |
| ------------------------ | -------------------------------- |
| `gemini-3.1-pro`         | `gemini-3.1-pro-preview`         |
| `gemini-3.1-flash-image` | `gemini-3.1-flash-image-preview` |

---

## Not Found on Vertex (404)

These model IDs have been tested and return 404 with `location: global`:

```
gemini-3-pro
gemini-3-pro-preview
gemini-3-flash-image
gemini-3-flash-preview
gemini-2.5-flash-image-preview
gemini-2.5-flash-lite-preview
gemini-2.0-flash
gemini-2.0-flash-001
gemini-2.0-flash-lite
gemini-1.5-flash
```

---

## Notes

- **Alias resolution** requires pool mode with `modelCatalog` configured.
  In single mode, aliases are not resolved — use the full model ID.
- **OpenAI provider catalog**: if `modelCatalog.openai` has rules, OpenAI
  routes resolve against it first, then fall back to `modelCatalog.gemini`.
- **Per-target filtering**: each pool entry supports `modelAllowlist` and
  `modelExclusions` to route specific models to specific targets.
