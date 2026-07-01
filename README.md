# Chang Store Vertex Gateway

Node 22 HTTP gateway that sits between the SPA/browser and Google Vertex AI.
It accepts requests with a gateway API key, authenticates upstream to Vertex AI
using server-side service account credentials, and exposes Gemini, OpenAI, and
Vertex-compatible API surfaces plus frontend-friendly image endpoints.

Zero web framework — pure `node:http`, `@google/genai` SDK, TypeScript compiled
to `compiled/` for production.

## Quick Start

```bash
cd gateway
npm ci
GATEWAY_API_KEYS=local-dev-key \
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json" \
GOOGLE_VERTEX_PROJECT="your-project-id" \
GOOGLE_VERTEX_LOCATION=global \
npm run dev
```

The credentials file must be a Google service account key JSON with top-level
`type: "service_account"`, `project_id`, `client_email`, and `private_key`.
OAuth client JSON files with top-level `installed` or `web` are rejected.

Point the SPA proxy at `http://localhost:8080/gemini` and use the value from
`GATEWAY_API_KEYS` as the proxy API key.

## Production Deployment

Gateway currently runs on a VPS via Docker Compose behind host nginx.

| Item | Value |
|------|-------|
| Public URL | `https://vertex.monet.uno` |
| Docs (public) | `https://vertex.monet.uno/docs` |
| Backend container | `vertex-gateway` |
| Bind | `127.0.0.1:19089 -> container:8080` |
| VPS host | `chang-gateway-vm` |
| TLS | host nginx, Let's Encrypt cert |
| Google project | `project-b82b6a5a-13c8-42e4-a56` |
| Google location | `global` |

Redeploy from the VPS:

```bash
cd /home/monet/vertex-gateway
sudo docker compose up -d --build
sudo nginx -t
sudo systemctl reload nginx
```

A Cloud Run deployment path also exists under `gcp/` (bootstrap, cloudbuild,
deploy scripts, Secret Manager credential mount). See `gcp/README.md` and
`gcp/cloud-run-rollout-plan.md`.

## Architecture

```
Client (SPA / SDK)
  |  Authorization: Bearer <gateway-api-key>
  v
+-----------------------------------------------------+
|  Gateway (node:http)                                |
|                                                     |
|  request-context -> CORS -> classifyRoute           |
|  -> requireGatewayAuth -> readBody                  |
|  -> model alias resolution -> stream admission      |
|  -> route handler (family dispatch)                 |
|                                                     |
|  GenAiPoolClient                                    |
|    |- target A (service account A)  --+             |
|    |- target B (service account B)  --| weighted RR |
|    +- target C (service account C)  --+ + failover  |
+-----------------------------------------------------+
  |  GoogleGenAI(vertexai: true, service account creds)
  v
Google Vertex AI
```

### Request Flow

1. `createRequestContext` — assigns `x-request-id`, structured JSON logging
   with redaction of token/key/base64/data fields.
2. `maybeHandleAdminRoute` — intercepts `/admin` before CORS/auth if admin
   routes are enabled.
3. `applyCors` + OPTIONS preflight handling.
4. Public routes (no auth): `/`, `/docs`, `/llms.txt`, `/healthz`, `/readyz`.
5. `classifyRoute` — regex-matches method + pathname into a `RouteFamily`
   (`gemini | openai | vertex | vtx | custom`) and `RouteOperation`.
6. `requireGatewayAuth` — constant-time comparison of the gateway API key
   (SHA256 hash + `timingSafeEqual`).
7. `readJsonBody` — skipped for GET and multipart image edits.
8. Model alias resolution via `modelCatalog` per provider.
9. Streaming detection -> `StreamAdmission` enforces per-key concurrency and
   queue limits before dispatch.
10. Family dispatch -> route handler builds a `@google/genai` request and calls
    `ai.models.generateContent` or `ai.models.generateContentStream` through
    the pool client.

## API Endpoints

### Health and Docs (public, no auth)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/` | Root JSON with service info |
| `GET` | `/docs` | Interactive HTML API documentation |
| `GET` | `/llms.txt` | LLM-friendly plain-text endpoint summary |
| `GET` | `/healthz` | Simple health check |
| `GET` | `/readyz` | Readiness + runtime mode + pool summary |

Use `/readyz` as the authoritative public smoke endpoint. In pool mode it
returns only summary counts (healthy/cooldown targets, selection strategy) —
no secrets.

### Gemini-Compatible

| Method | Path |
|--------|------|
| `GET` | `/gemini/v1beta/models` |
| `POST` | `/gemini/v1beta/models/{model}:generateContent` |
| `POST` | `/gemini/v1beta/models/{model}:streamGenerateContent` |

Native Gemini shape. Streaming returns SSE `data: <json>` frames and does
**not** append `data: [DONE]` so the official `@google/genai` stream parser
works through a custom base URL.

### OpenAI-Compatible

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/openai/v1/models` | Minimal model list |
| `POST` | `/openai/v1/chat/completions` | JSON + SSE (`stream: true`) |
| `POST` | `/openai/v1/responses` | Text-first subset, JSON + SSE |
| `POST` | `/openai/v1/images/generations` | Returns `data[].b64_json` |
| `POST` | `/openai/v1/images/edits` | JSON data-url or multipart upload |

Set `baseURL` to `<origin>/openai/v1` when using the OpenAI SDK.

Chat completions convert OpenAI messages to Gemini `contents`, support system
instructions, function tool calls, and `temperature`/`top_p`/`max_tokens`/
`stop`/`n` mapping. Streaming limits: `n: 1` only, no streaming tool calls.

Responses subset: `input` string or message array, `instructions`,
`temperature`/`top_p`/`max_output_tokens`, non-streaming function tools,
`tool_choice` (`auto`/`none`/`required`/specific). Streaming is text-first
with semantic SSE events (`response.created`, `response.output_text.delta`,
`response.completed`).

### Vertex-Compatible

| Method | Path |
|--------|------|
| `POST` | `/vertex/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent` |
| `POST` | `/vertex/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent` |
| `POST` | `/vertex/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:predict` |
| `POST` | `/vtx/v1/models/{model}:generateContent` |
| `POST` | `/vtx/v1/models/{model}:predict` |

`predict` converts `instances[]` into Gemini `contents[]` and maps
`parameters` to `config`.

### Custom (frontend-friendly)

| Method | Path | Operation |
|--------|------|-----------|
| `POST` | `/api/images/generate` | Image generation |
| `POST` | `/api/images/edit` | Image editing with reference images |
| `POST` | `/api/images/upscale` | Image upscaling |
| `POST` | `/api/images/describe` | Image description / captioning |
| `POST` | `/api/session/validate` | Text smoke / session validation |

Custom image routes return `{ images: [{ dataUrl, mimeType, index }] }`.
Default image model: `gemini-3.1-flash-image-preview`.

## Authentication

### Gateway API Key

Accepts any of:

```
Authorization: Bearer <gateway-api-key>
x-api-key: <gateway-api-key>
x-goog-api-key: <gateway-api-key>
```

Compared with constant-time equality (SHA256 hash + `timingSafeEqual`). Keys
are set via `GATEWAY_API_KEYS` env var (comma-separated) or `gatewayKeys` in
config file.

### Admin Token

`/admin/api/*` routes require a separate `Authorization: Bearer
<admin-token>`. The admin token must not overlap with any gateway API key.
Admin routes do not accept `x-api-key`, `x-goog-api-key`, query tokens, or
cookies.

### Upstream (Vertex AI)

Server-side only. Service account JSON loaded from
`GOOGLE_APPLICATION_CREDENTIALS` or per-pool `credentialsFile`. The client
never sends Google credentials. OAuth client JSON (`installed`/`web`) is
rejected.

## Vertex Pool and Failover

When `vertexPools` is configured, the gateway runs in `pool` mode with
multiple Vertex targets behind a single `GenAiPoolClient`.

### Selection

- **weighted-round-robin** (default) — smooth weighted distribution using the
  current-weight decrement algorithm.
- **round-robin** — simple cyclic selection.

### Health and Failover

Each target tracks:

- `status`: `healthy | cooldown | disabled`
- `success` / `failure` counters (global + per route family)
- `lastErrorCode`, `lastErrorAt`, `cooldownUntil`
- recent events (last 10)

On upstream failure, `classifyUpstreamError` determines whether the error is
failover-worthy (`shouldFailover`) and whether to cooldown the target
(`shouldCooldown`, default 60s). Non-streaming requests retry the next
healthy target within the same call. Streaming requests failover only if the
first chunk hasn't been received yet — once streaming starts, the target is
pinned.

If all targets are in cooldown, the gateway falls back to the target with the
nearest cooldown expiry.

### Per-Target Model Filtering

Each pool entry supports `modelAllowlist` and `modelExclusions` to route
specific models to specific targets.

### Current Pool

`pool-config.local.json` defines 3 targets, all in project
3 different GCP projects (`project-b82b6a5a-13c8-42e4-a56`, `monet-ai-2`,
`monet-ai-3`), all at location `global`, each with a distinct service
account. This distributes quota/RPS across projects and provides
cross-project redundancy.

## Model Catalog

`modelCatalog` provides per-provider model resolution:

- **aliases** — map short names to real model IDs (e.g.
  `gemini-3.1-pro` -> `gemini-3.1-pro-preview`)
- **disabled** — reject specific models with `400 VALIDATION_FAILED`
- **allowlist** — restrict to a set of allowed models
- **defaultModel** — fallback when no model is specified

Current aliases:

| Alias | Resolves To |
|-------|-------------|
| `gemini-3.1-pro` | `gemini-3.1-pro-preview` |
| `gemini-3-flash` | `gemini-3-flash-preview` |
| `gemini-3.1-flash-image` | `gemini-3.1-flash-image-preview` |

App defaults: text `gemini-3.5-flash`, image `gemini-3.1-flash-image`.

## Configuration

Three layers, highest priority first:

1. **Environment variables** (`GATEWAY_*`, `GOOGLE_*`) — override everything.
2. **Pool overlay** (`GATEWAY_POOL_CONFIG_FILE`, JSON) — nested config:
   `vertexPools`, `modelCatalog`, `vertexPoolSelection`, admin settings.
3. **File config** (`GATEWAY_CONFIG_FILE`, YAML or JSON) — base scalar/list
   config: gateway keys, CORS, timeouts, route switches.

Nested config (`vertexPools`, `modelCatalog`) must be JSON — do not put these
in the flat YAML file.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server bind port (Cloud Run injects this) |
| `GATEWAY_API_KEYS` | — | Comma-separated accepted API keys (required) |
| `GATEWAY_CORS_ORIGINS` | — | Comma-separated allowed origins |
| `GATEWAY_ALLOW_WILDCARD_CORS` | `false` | Allow all origins (keep false in prod) |
| `GOOGLE_VERTEX_PROJECT` | — | GCP project ID |
| `GOOGLE_VERTEX_LOCATION` | `us-central1` | Vertex location (`global` recommended) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to service account JSON |
| `GOOGLE_GENAI_API_VERSION` | `v1` | Vertex API version |
| `GATEWAY_CONFIG_FILE` | — | Path to flat YAML/JSON config file |
| `GATEWAY_POOL_CONFIG_FILE` | — | Path to pool overlay JSON file |
| `GATEWAY_MAX_JSON_BYTES` | `8388608` | Max JSON body size (8 MB) |
| `GATEWAY_MAX_IMAGES` | `4` | Max images per request |
| `GATEWAY_MAX_DECODED_IMAGE_BYTES` | `6291456` | Max total decoded image bytes (6 MB) |
| `GATEWAY_UPSTREAM_TIMEOUT_MS` | `45000` | Upstream call timeout |
| `GATEWAY_UPSTREAM_CONCURRENCY` | `4` | Max concurrent upstream requests |
| `GATEWAY_STREAM_MAX_DURATION_MS` | `240000` | Max stream duration (4 min) |
| `GATEWAY_STREAM_IDLE_TIMEOUT_MS` | `30000` | Stream idle timeout |
| `GATEWAY_STREAM_PER_KEY_LIMIT` | `2` | Max concurrent streams per key |
| `GATEWAY_STREAM_QUEUE_LIMIT` | `4` | Stream queue limit (fail fast) |
| `GATEWAY_VERTEX_POOL_FAILOVER_COOLDOWN_MS` | `60000` | Cooldown after target failure |
| `GATEWAY_VERTEX_POOL_SELECTION` | `weighted-round-robin` | Pool selection strategy |
| `GATEWAY_ENABLE_GEMINI_ROUTES` | `true` | Toggle `/gemini/*` |
| `GATEWAY_ENABLE_OPENAI_ROUTES` | `true` | Toggle `/openai/*` |
| `GATEWAY_ENABLE_VERTEX_ROUTES` | `true` | Toggle `/vertex/*` |
| `GATEWAY_ENABLE_VTX_ROUTES` | `true` | Toggle `/vtx/*` |
| `GATEWAY_ENABLE_IMAGE_ROUTES` | `true` | Toggle `/api/images/*` |
| `GATEWAY_ENABLE_ADMIN_ROUTES` | `false` | Toggle `/admin/*` |
| `GATEWAY_ADMIN_TOKEN` | — | Admin API token (required if admin enabled) |
| `GATEWAY_ADMIN_ALLOW_MUTATIONS` | `false` | Allow admin write operations |
| `GATEWAY_ADMIN_STORE_MODE` | `static-config` | `static-config` or `file-store` |
| `GATEWAY_ADMIN_FILE_STORE_DIR` | — | Directory for file-store persistence |

### Config File (`config.yaml`)

```yaml
port: 8080
corsOrigins:
  - http://localhost:3000
  - http://127.0.0.1:3000
googleProject: project-b82b6a5a-13c8-42e4-a56
googleCredentialsFile: /run/vertex-accounts/active.json
googleLocation: global
googleApiVersion: v1
maxJsonBytes: 8388608
maxImages: 4
maxDecodedImageBytes: 6291456
upstreamTimeoutMs: 45000
upstreamConcurrency: 4
enableGeminiRoutes: true
enableVertexRoutes: true
enableVtxRoutes: true
enableImageRoutes: true
```

### Pool Overlay (`pool-config.local.json`)

```json
{
  "vertexPoolSelection": "weighted-round-robin",
  "vertexPools": [
    {
      "id": "monet-ai-project",
      "label": "Monet AI Project",
      "project": "project-b82b6a5a-13c8-42e4-a56",
      "location": "global",
      "credentialsFile": "/run/vertex-accounts/monet-ai-project.json",
      "enabled": true,
      "weight": 1
    }
  ],
  "modelCatalog": {
    "gemini": {
      "aliases": { "gemini-3.1-pro": "gemini-3.1-pro-preview" },
      "allowlist": [],
      "disabled": []
    }
  }
}
```

## Admin API

Enabled when `GATEWAY_ENABLE_ADMIN_ROUTES=true` and `GATEWAY_ADMIN_TOKEN` is
set. The admin UI shell is at `/admin` (no secrets exposed). All `/admin/api/*`
routes require `Authorization: Bearer <admin-token>`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/api/health` | Runtime + pool health summary |
| `GET` | `/admin/api/health/pool` | Detailed pool health |
| `GET` | `/admin/api/vertex-credentials` | List credential targets (redacted) |
| `POST` | `/admin/api/vertex-credentials/import` | Import service account JSON |
| `GET` | `/admin/api/vertex-credentials/{id}` | Credential detail (redacted) |
| `PATCH` | `/admin/api/vertex-credentials/{id}` | Update label/weight/enabled/model filters |
| `DELETE` | `/admin/api/vertex-credentials/{id}` | Remove a credential target |
| `POST` | `/admin/api/vertex-credentials/{id}/test` | Probe one target |
| `GET` | `/admin/api/models?provider=gemini` | Read model catalog |
| `PUT` | `/admin/api/models/{provider}` | Persist model catalog |
| `POST` | `/admin/api/runtime/reload` | Hot-reload runtime from store |

### File-Store Mode

`adminStoreMode: "file-store"` with `adminAllowMutations: true` persists
credentials and model catalog to disk (`store.json` + credential files) with
atomic writes (tmp -> rename) and backup/rollback on failure. Requires a
persistent mounted volume (e.g. `./gateway-data/auths:/data/auths`).

Cloud Run rejects this mode at startup (`K_SERVICE` check) — file-store is
Docker/VPS only.

## Docker Compose

`docker-compose.yml` at the repo root:

- Mounts `./gateway/config.yaml` into `/app/config.yaml`
- Loads runtime env from `./gateway/.env`
- Mounts read-only credential directory into `/run/vertex-accounts`

```bash
docker compose up -d --build
```

Default host port is `19089`. Override:

```bash
GATEWAY_HOST_PORT=19123 docker compose up -d --build
```

App config:
- Proxy URL: `http://localhost:19089/gemini`
- Proxy API Key: value from `GATEWAY_API_KEYS` in `gateway/.env`

### Doi Service Account

Neu file account JSON khac van nam trong cung thu muc host da mount, chi can
sua `GOOGLE_APPLICATION_CREDENTIALS` trong `gateway/.env` roi rebuild. Khong
can sua `docker-compose.yml`.

## Cloud Run Deployment

See `gcp/README.md` for full details. Summary:

1. `bash gcp/bootstrap-cloud-run.sh` — enable APIs, create Artifact Registry
   repo, runtime service account, Secret Manager secret.
2. Copy `gcp/cloud-run.env.yaml.example` to `gcp/cloud-run.env.yaml` and fill
   in production values.
3. `bash gcp/deploy-cloud-run.sh` — build via Cloud Build, deploy to Cloud Run
   with secret-mounted credentials at `/run/secrets/vertex-account.json`.

Cloud Run config: 1 CPU, 1 Gi memory, concurrency 20, timeout 300s, max 10
instances. Region `asia-southeast1`.

Do not set `PORT` in the env file — Cloud Run injects it automatically.

## Testing

```bash
npm run test          # Vitest — all unit/integration tests
npm run dev           # Dev server (tsx src/server.ts)
npm run compile       # TypeScript compile to compiled/
npm start             # Run compiled output (node compiled/server.js)
```

Tests mirror `src/` under `test/` and cover: auth, admin routes, CORS, request
classification, streaming, image routes, OpenAI compatibility, pool behavior,
error responses, and the Dockerfile.

### Smoke Test

`scripts/cloud-run-smoke.mjs` runs an end-to-end smoke against a deployed
gateway:

```bash
GATEWAY_BASE_URL=https://vertex.monet.uno \
GATEWAY_API_KEY=<key> \
node scripts/cloud-run-smoke.mjs
```

Tests: `/readyz`, OpenAI models/chat/chat-stream/responses/responses-stream,
image generations/edits, custom image generate, Gemini stream, Vertex stream.

## Project Structure

```
gateway/
|-- src/
|   |-- app.ts                 # HTTP server entry, request dispatch
|   |-- server.ts              # Process bootstrap, config load, listen
|   |-- config/env.ts          # Config loading (env + file + pool overlay)
|   |-- auth/
|   |   |-- gateway-auth.ts    # Gateway API key auth (constant-time)
|   |   `-- google-auth.ts     # Service account credential loader
|   |-- http/
|   |   |-- request-classifier.ts  # Route classification by method+path
|   |   |-- request-context.ts     # Request ID, structured logging, redaction
|   |   |-- error-response.ts      # GatewayError, sendError, sendJson
|   |   `-- sse-response.ts        # SSE frame writing, stream forwarding
|   |-- routes/
|   |   |-- gemini-compatible-routes.ts
|   |   |-- openai-compatible-routes.ts
|   |   |-- openai-responses-routes.ts
|   |   |-- openai-images-routes.ts
|   |   |-- vertex-compatible-routes.ts
|   |   |-- custom-image-routes.ts
|   |   |-- health-routes.ts
|   |   `-- docs-ui.ts
|   |-- strategies/
|   |   `-- compatibility-strategy.ts  # Gemini/Vertex request building
|   |-- workloads/
|   |   |-- image-workloads.ts     # Image generate/edit/upscale/describe
|   |   `-- image-normalizer.ts    # Inline image extraction, text extraction
|   |-- lib/
|   |   |-- genai-pool.ts          # Pool client, selection, health, failover
|   |   |-- genai-runtime.ts       # Runtime lifecycle, snapshot, reload, probe
|   |   |-- google-genai-client.ts # @google/genai client factory per target
|   |   |-- genai-request-metadata.ts
|   |   |-- stream-admission.ts    # Per-key stream concurrency + queue
|   |   |-- stream-guards.ts       # Idle/duration guards per stream chunk
|   |   |-- upstream-error-classifier.ts
|   |   |-- concurrency.ts         # Semaphore
|   |   |-- retry.ts               # Retry with jitter
|   |   |-- timeout.ts             # Promise timeout
|   |   |-- cors.ts
|   |   |-- read-json.ts
|   |   |-- read-multipart.ts
|   |   `-- image-data-url.ts
|   `-- admin/
|       |-- admin-routes.ts        # Admin API endpoints
|       |-- admin-auth.ts          # Admin token auth
|       |-- admin-ui.ts            # Admin dashboard HTML shell
|       |-- credential-store.ts    # File-store persistence, import/rollback
|       `-- model-store.ts         # Model catalog resolution
|-- test/                      # Vitest tests mirroring src/
|-- compiled/                 # TypeScript build output (production)
|-- accounts/                 # Service account JSON files (gitignored)
|-- scripts/cloud-run-smoke.mjs
|-- config.yaml               # Base flat config for Docker Compose
|-- pool-config.local.json    # Pool overlay config
|-- Dockerfile                # Multi-stage build (deps -> compile -> runtime)
|-- package.json
`-- tsconfig.json
```

## Known Limitations

- OpenAI streaming: `n: 1` only, no streaming tool calls.
- OpenAI Responses: text-first only, no built-in/hosted tools, no
  `parallel_tool_calls`, no persistence fields (`background`, `conversation`,
  `store`, `previous_response_id`).
- `file-store` admin mutations are Docker/VPS only (Cloud Run rejects at
  startup).
- Gateway uses one service account per pool target; no cross-project
- The current 3-pool config uses 3 different GCP projects for cross-project
  quota distribution and redundancy.
- `gemini-3-flash` and `gemini-3.1-pro` (without `-preview` suffix) return
  `404` on Vertex; use aliases or the `-preview` model IDs directly.

## Operational Notes

- Keep `GOOGLE_VERTEX_LOCATION=global` for the current model matrix.
- Keep `GATEWAY_ALLOW_WILDCARD_CORS=false` in production.
- Keep `GATEWAY_STREAM_PER_KEY_LIMIT` low and `GATEWAY_STREAM_QUEUE_LIMIT`
  finite to fail fast rather than hang indefinitely.
- Set stream idle/duration timeouts lower than the Cloud Run instance timeout.
- Never put service account JSON in Vite env, localStorage, or browser requests.
- Do not reuse the admin token as a gateway API key or vice versa.
- `GET /docs` and `GET /llms.txt` are public and do not require a gateway key.

## Related Documentation

- `docs/api/vertex-gateway-api-guide.md` — full API reference with examples
- `docs/api/vertex-gateway-runbook.md` — VPS operations, logs, smoke tests
- `gcp/README.md` — Cloud Run deployment guide
- `gcp/cloud-run-rollout-plan.md` — rollout plan and validation checklist
