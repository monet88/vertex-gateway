# Vertex Gateway

Node 22 HTTP gateway between frontend apps and Google Vertex AI. Accepts a
**gateway API key**, authenticates upstream with server-side credentials.
Exposes Gemini, OpenAI, Vertex, and custom image API surfaces.

Pure `node:http` + `@google/genai` SDK, zero framework.

## Quick Start

```bash
npm ci && cp .env.example .env   # edit .env with your values
npm run dev                      # http://localhost:8080
```

## Docker Deployment

```bash
cp .env.example .env && cp /path/to/sa.json accounts/active.json
docker compose up -d --build     # http://localhost:19089
curl -s http://localhost:19089/readyz
```

Compose mounts a boot-safe [`pool-config.example.json`](pool-config.example.json)
(single mode, no pools) by default, so a fresh checkout starts without extra
setup. To use your own overlay with Docker, copy it and point the Compose
host-side mount variable `GATEWAY_POOL_CONFIG` at it in `.env` (the file is
gitignored):

```env
GATEWAY_POOL_CONFIG=./pool-config.local.json
```

Inside the container, Compose maps that file to `/app/pool-config.local.json`
and sets `GATEWAY_POOL_CONFIG_FILE` for the gateway process. For non-Docker
local runs, set `GATEWAY_POOL_CONFIG_FILE=./pool-config.local.json` directly.

### Multi-project (full Vertex API-key mode by default)

Add to `.env` — no JSON config needed:

```env
VERTEX_POOLS=project-a:global:AIzaKey1,project-b:global:AIzaKey2,project-c:global:AIzaKey3
```

Format: `project:location:apiKey` per entry. Because each entry includes
`project` + `location`, `VERTEX_POOLS` defaults these targets to full Vertex
API-key mode and auto-creates pool mode with round-robin. For advanced options
(model filtering, service accounts, or explicit `apiKeyMode:
"express"` API-key-only targets), use `pool-config.local.json` instead — see
[Pool Mode](#pool-mode).

## Authentication

**Gateway key** (client → gateway): set via `GATEWAY_API_KEYS` env
(comma-separated). Pass as `Authorization: Bearer <key>`, `x-api-key`, or
`x-goog-api-key`. Not a Google Cloud key.

**Upstream** (gateway → Google, server-side only):
- Service account JSON via `credentialsFile` or `GOOGLE_APPLICATION_CREDENTIALS`
- Google Cloud API key via `apiKey` or `GOOGLE_GENAI_API_KEY`
  - defaults to full Vertex API-key mode when the target includes `project` and `location` (including `VERTEX_POOLS` entries)
  - single mode with only `GOOGLE_GENAI_API_KEY` and no project remains legacy SDK API-key-only express behavior
  - use `apiKeyMode: "express"` in a pool target to keep SDK API-key-only behavior for that target
- If both present, `apiKey` wins

## API Surfaces

Interactive docs at `GET /docs`. LLM-friendly summary at `GET /llms.txt`.

| Surface | Base URL | Key Endpoints |
|---------|----------|---------------|
| **Gemini** | `/gemini/` | `GET models`, `POST models/{m}:generateContent`, `POST models/{m}:streamGenerateContent` |
| **OpenAI** | `/openai/v1` | `GET models`, `POST chat/completions`, `POST responses`, `POST images/generations`, `POST images/edits` |
| **Vertex** | `/vertex/v1/projects/…` | `POST :generateContent`, `POST :streamGenerateContent`, `POST :predict` |
| **Vtx** (shorthand) | `/vtx/v1/` | `POST models/{m}:generateContent`, `POST models/{m}:predict` |
| **Custom** | `/api/` | `POST images/generate`, `POST images/edit`, `POST images/upscale`, `POST images/describe`, `POST session/validate` |

> ⚠️ OpenAI `images/generations` rejects `response_format`, `quality`, `style`,
> `background`, `user`. Always returns `b64_json`.

## SDK Examples

```python
# Gemini SDK
from google import genai
from google.genai import types
client = genai.Client(
    api_key="<gateway-key>",
    http_options=types.HttpOptions(base_url="http://localhost:19089/gemini/"),
)
r = client.models.generate_content(model="gemini-3.5-flash", contents="Hello!")
```

```python
# OpenAI SDK
from openai import OpenAI
client = OpenAI(base_url="http://localhost:19089/openai/v1", api_key="<gateway-key>")
r = client.chat.completions.create(
    model="gemini-3.5-flash", messages=[{"role": "user", "content": "Hello!"}]
)
```

## Pool Mode

Docker users set `GATEWAY_POOL_CONFIG` in `.env` to choose which host overlay
file Compose mounts. Non-Docker users set `GATEWAY_POOL_CONFIG_FILE` directly to
the overlay JSON path. The overlay defines multiple Vertex targets with
round-robin selection by default, or `bind-first` to keep using the first
healthy target and rotate only on failover/cooldown. Each target uses either a
service account (`credentialsFile`) or API key (`apiKey`). API-key targets
default to full Vertex routing when they include `project` + `location`; set
`apiKeyMode: "express"` on a pool entry to use the SDK API-key-only path
instead. Failover with 60s cooldown; streaming fails over only before first
chunk.

`modelCatalog` provides per-provider aliases, allowlist, disabled list, and
default model.

## Configuration

Three layers (highest priority first): **env vars** → **pool overlay JSON**
(`GATEWAY_POOL_CONFIG_FILE`) → **base YAML** (`GATEWAY_CONFIG_FILE`).

See [.env.example](.env.example) for all variables. Key defaults: port `8080`,
location `us-central1`, unrestricted CORS when `GATEWAY_CORS_ORIGINS` /
`corsOrigins` is omitted or empty, upstream timeout 45s, concurrency 4, stream
limit 2/key. Set `GATEWAY_CORS_ORIGINS` to a comma-separated origin list only
when browser access should be restricted to specific domains.

## Admin API

Enable with `GATEWAY_ENABLE_ADMIN_ROUTES=true` + `GATEWAY_ADMIN_TOKEN`. UI at
`/admin`, API at `/admin/api/*`. Supports credential import, pool health,
model catalog management, and hot-reload. File-store mode for persistence
(Docker/VPS only — Cloud Run rejects).

## Models

Recommended: `gemini-3.5-flash` (text), `gemini-3.1-flash-image-preview`
(image). All require `location: global`.

Full list, aliases, and 404s: [docs/model-list.md](docs/model-list.md).

## Development

```bash
npm run dev       # tsx dev server
npm run test      # vitest
npm run compile   # tsc → compiled/
npm start         # node compiled/server.js
```

## Known Limitations

- OpenAI streaming: `n: 1` only, no streaming tool calls
- OpenAI Responses: text-first only, no built-in tools, no persistence
- `gemini-3-flash` / `gemini-3.1-pro` without `-preview` → 404 (use aliases)
- All current models require `location: global`
