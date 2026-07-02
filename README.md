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

### Multi-project (express mode)

Add to `.env` — no JSON config needed:

```env
VERTEX_POOLS=project-a:global:AIzaKey1,project-b:global:AIzaKey2,project-c:global:AIzaKey3
```

Format: `project:location:apiKey` per entry. Auto-creates pool mode with
round-robin. For advanced options (weights, model filtering, service accounts),
use `pool-config.local.json` instead — see [Pool Mode](#pool-mode).

## Authentication

**Gateway key** (client → gateway): set via `GATEWAY_API_KEYS` env
(comma-separated). Pass as `Authorization: Bearer <key>`, `x-api-key`, or
`x-goog-api-key`. Not a Google Cloud key.

**Upstream** (gateway → Google, server-side only):
- Service account JSON via `credentialsFile` or `GOOGLE_APPLICATION_CREDENTIALS`
- Google Cloud API key via `apiKey` or `GOOGLE_GENAI_API_KEY` (express mode)
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

`pool-config.local.json` defines multiple Vertex targets with weighted
round-robin (default) or round-robin selection. Each target uses either a
service account (`credentialsFile`) or API key (`apiKey`). Failover with 60s
cooldown; streaming fails over only before first chunk.

`modelCatalog` provides per-provider aliases, allowlist, disabled list, and
default model.

## Configuration

Three layers (highest priority first): **env vars** → **pool overlay JSON**
(`GATEWAY_POOL_CONFIG_FILE`) → **base YAML** (`GATEWAY_CONFIG_FILE`).

See [.env.example](.env.example) for all variables. Key defaults: port `8080`,
location `us-central1`, upstream timeout 45s, concurrency 4, stream limit
2/key.

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
