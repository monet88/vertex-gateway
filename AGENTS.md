# Vertex Gateway — Agent Rules

> **Scope**: Workspace rules for `vertex-gateway`. Auto-loaded by any agent
> working in this repository.

---

## What Is This?

Node.js (`node:http`, zero-framework) HTTP gateway proxy between
**client/frontend** and **Google Vertex AI / Gemini API**.

- 5 API surfaces: Gemini, OpenAI, Vertex, vtx shorthand, custom image
- Pool mode: load-balance + failover across multiple GCP projects
- See `README.md` for full endpoint reference and SDK examples

---

## Tool Preferences

- **Shell/bash commands**: prefer Desktop Commander (`start_process` +
  `interact_with_process`) for running local commands instead of other exec
  tools.
- **GitHub operations**: prefer GitHub MCP tools (`github.*`) over shelling
  out to `gh` CLI for PR/issue read, review, search, and write actions.
- **Web search**: prefer Exa (`web_search_exa`, `web_search_advanced_exa`,
  `web_fetch_exa`) as the default search tool.

---

## Two Auth Concepts — CRITICAL Distinction

**KHÔNG ĐƯỢC nhầm lẫn hai tầng này:**

### Tầng 1 — Gateway API Key (Client → Gateway)

Key nội bộ do operator tạo. Cấu hình: `GATEWAY_API_KEYS` (`.env`,
comma-separated, ưu tiên cao nhất) hoặc `gatewayKeys` trong `config.yaml`.

Truyền qua: `Authorization: Bearer`, `x-api-key`, hoặc `x-goog-api-key`.
So sánh bằng SHA256 + `timingSafeEqual`.

> ⚠️ **KHÔNG** phải Google Cloud API key.

### Tầng 2 — Upstream Credentials (Gateway → Google)

Client KHÔNG bao giờ thấy. Hai kiểu per pool target:

**Kiểu A — Service Account JSON** (`credentialsFile`): cần `type:
"service_account"`, `project_id`, `client_email`, `private_key`. OAuth client
JSON bị reject. Cache by filesystem fingerprint (dev+ino+size+mtime+ctime).

**Kiểu B — Google Cloud API Key** (`apiKey`): mặc định **full Vertex** khi
pool target có `project` + `location`; gateway gọi REST endpoint đầy đủ và gửi
`x-goog-api-key`. Chỉ dùng **express mode** khi `apiKeyMode: "express"` hoặc
single mode chỉ có `GOOGLE_GENAI_API_KEY` mà không có usable project/location;
khi đó SDK init với chỉ `apiKey` và cố ý bỏ `project`/`location` vì SDK không
cho kết hợp API key với project/location.

> ⚠️ **Priority**: `apiKey` thắng `credentialsFile` nếu cả hai present.

**Single mode** (không pool): `GOOGLE_APPLICATION_CREDENTIALS` hoặc
`GOOGLE_GENAI_API_KEY` + `GOOGLE_VERTEX_PROJECT` + `GOOGLE_VERTEX_LOCATION` để
chạy full Vertex API-key mode. Nếu chỉ có `GOOGLE_GENAI_API_KEY`, single mode
giữ legacy SDK API-key-only express behavior.

---

## Config Hierarchy

```
1. ENV VARS (highest)        GATEWAY_API_KEYS, GOOGLE_VERTEX_PROJECT, ...
2. Pool Overlay JSON         GATEWAY_POOL_CONFIG_FILE → pool-config.local.json
   - Docker host mount uses GATEWAY_POOL_CONFIG → /app/pool-config.local.json
3. Base YAML/JSON            GATEWAY_CONFIG_FILE → config.yaml
```

- `vertexPools`, `modelCatalog`, admin settings → PHẢI trong pool overlay JSON
- Docker: `.env` dùng `GATEWAY_POOL_CONFIG` để chọn host overlay mount vào container
- Non-Docker: dùng `GATEWAY_POOL_CONFIG_FILE` trỏ thẳng đến overlay JSON
- `vertexPools.length > 0` → `"pool"` mode, ngược lại `"single"`

| File | Purpose |
|------|---------|
| `.env` | Gateway keys, basic env (gitignored) |
| `config.yaml` | Base flat: CORS, timeouts, route switches |
| `pool-config.local.json` | Pool overlay: vertexPools, modelCatalog, admin |
| `accounts/*.json` | Service account files (gitignored) |

---

## Local Dev

| Item | Value |
|------|-------|
| Container | `vertex-gateway` |
| Port | `19089` → `8080` |
| Gateway key | Local value from `.env` / `GATEWAY_API_KEYS` |
| Health | `GET /healthz` |
| Readiness | `GET /readyz` |

Restart: `docker compose up -d --build`

---

## Key Source Files

| File | What it does |
|------|-------------|
| `src/app.ts` | HTTP server, request dispatch |
| `src/config/env.ts` | 3-layer config loading + validation |
| `src/http/request-classifier.ts` | Route classification (method+path → family+operation) |
| `src/http/route-dispatch.ts` | Family → handler dispatch table |
| `src/auth/google-auth.ts` | SA JSON loading, fingerprint cache |
| `src/lib/google-genai-client.ts` | Client factory (full API-key REST vs express SDK vs SA) |
| `src/lib/vertex-rest-client.ts` | Full Vertex API-key REST client + SSE parser |
| `src/lib/genai-pool.ts` | Pool selection (WRR/RR), failover, health |
| `src/lib/genai-runtime.ts` | Runtime lifecycle, hot-reload, probe |
| `src/routes/openai-images-routes.ts` | Rejects: `response_format`, `quality`, `style`, `background`, `user` |
| `src/admin/credential-store.ts` | File-store persistence, atomic write |

---

## Models

Recommended: `gemini-3.5-flash` (text), `gemini-3.1-flash-image-preview`
(image). All require `location: "global"`.

Full list, aliases, OpenAI image allowlist, 404s: [`docs/model-list.md`](docs/model-list.md).

---

## Security Rules (Never Violate)

- ❌ KHÔNG commit `accounts/*.json`
- ❌ KHÔNG để gateway key lộ ra client/browser
- ❌ KHÔNG dùng admin token trùng gateway key
- ❌ KHÔNG bật `GATEWAY_ALLOW_WILDCARD_CORS=true` trong production
- ❌ `file-store` admin mutations không chạy trên Cloud Run
