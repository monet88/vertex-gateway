# Architecture

This document orients a newcomer to `vertex-gateway`: where things live, and
what is deliberately true about the design. For the endpoint reference and
SDK usage examples, see `README.md`. For agent-facing conventions, see
`AGENTS.md`.

## Bird's Eye View

`vertex-gateway` is a `node:http` proxy that sits between client applications
and Google's Vertex AI / Gemini API. It accepts a request in one of five
shapes (native Gemini, OpenAI-compatible, native Vertex, a `vtx` shorthand, or
a custom image API), authenticates the caller with a gateway-issued key,
translates the request into the gateway's SDK-compatible `GenAiClient` request
shape, and returns either a JSON body or a re-emitted Server-Sent-Events stream.

The gateway holds two kinds of state in memory: the resolved `GatewayConfig`
(built once at startup from env vars, an optional pool overlay JSON, and an
optional base YAML/JSON file) and, in pool mode, a `GenAiPoolSnapshot` per
Vertex target that tracks live health/cooldown state and round-robin cursors.
Everything else -- the translated request body, the classified route, the
upstream response -- is computed fresh per request and discarded. The only
thing a client can submit besides the request body is its gateway key; there
is no session or conversation state held server-side (OpenAI Responses
`previous_response_id`/`store`/`conversation` are explicitly rejected).

## Code Map

Ordered by data flow: request in, core translation and dispatch, upstream
client, then the process entry point. The optional admin subsystem is
described separately at the end since it manages the core's config rather
than participating in the request path.

### `src/config/env.ts`

Loads and validates `GatewayConfig` from three layers (env vars, pool overlay
JSON, base YAML/JSON -- highest priority first) and resolves whether the
gateway runs in `single` or `pool` mode based on whether `vertexPools` is
non-empty. Exposes `createDerivedConfig` so the admin subsystem can produce a
new config from a mutated credential/model-catalog snapshot without
duplicating the merge logic.

**Architecture Invariant:** `vertexPools`, `modelCatalog`, and admin settings
can only come from the pool overlay JSON, never the base config file --
`validateFileConfig` throws if it sees those keys in the wrong layer, so the
three-layer precedence can't be silently bypassed.

`GatewayConfig` is an **API Boundary**: every other module (auth, routing,
the GenAI client factory, the admin store) takes it as a plain, already-
validated value and never re-reads env vars or files itself.

### `src/http/request-classifier.ts`

Pure `(method, pathname) -> ClassifiedRoute` mapping. Encodes the entire
route allowlist as regex/exact matches; anything not matched throws a 404
`GatewayError` rather than falling through.

**Architecture Invariant:** this module knows nothing about auth, config, or
the GenAI client -- classification cannot fail or succeed based on request
body or headers, only method and path.

### `src/auth/`

Two independent auth concepts, kept in separate files on purpose (see
`AGENTS.md` for the full rationale):

- `gateway-auth.ts` -- client to gateway. Extracts a candidate key from
  `Authorization: Bearer`, `x-api-key`, or `x-goog-api-key`, and compares it
  against `config.gatewayKeys` using SHA-256 + `timingSafeEqual` to avoid
  timing attacks.
- `google-auth.ts` -- gateway to Google. Loads and validates a service account
  JSON (rejecting OAuth client JSON), caching the parsed credential by a
  filesystem fingerprint (`dev:ino:size:mtime:ctime`) so a hot-reloaded config
  doesn't force a re-parse when the underlying file hasn't changed.

### `src/admin/model-store.ts`

Resolves a client-requested model name through a provider's alias map,
allowlist, and disabled list. Called from `app.ts` before dispatch so alias
rewriting happens once, uniformly, regardless of which route family handles
the request.

### `src/lib/google-genai-client.ts` and `vertex-rest-client.ts`

`google-genai-client.ts` turns a `GatewayConfig` (or a single pool target) into
a `GenAiClient`. It decides per target between full Vertex API-key REST mode,
SDK API-key-only express mode, and SDK service-account/ADC auth. In single
mode, the synthetic `legacy-default` target infers full mode when
`GOOGLE_GENAI_API_KEY` is paired with usable project/location, and keeps legacy
express mode when only `GOOGLE_GENAI_API_KEY` is configured.

`vertex-rest-client.ts` implements the full Vertex API-key `GenAiClient`: it
moves `model` into `/projects/{project}/locations/{location}/publishers/google/models/{model}`,
sends the remaining SDK-compatible request body as JSON, authenticates with
`x-goog-api-key`, and parses SSE events for streaming calls.

**Architecture Invariant:** a target with `apiKeyMode: "full"` and an `apiKey`
uses the REST client with the selected target's `project` and `location` in the
Vertex resource path. A target with `apiKeyMode: "express"` uses the SDK
API-key-only path and deliberately omits `project` and `location` from SDK
options because the SDK does not support combining API-key auth with
project/location initialization.

`GenAiClient` is an **API Boundary**: it is the only interface the rest of
the codebase (routes, strategies, workloads) talks to for model calls. No
route module imports `GoogleGenAI` or `fetch` for Vertex calls directly, which
lets tests inject a fake `generateContent`/`generateContentStream` pair.

### `src/lib/genai-pool.ts` and `src/lib/genai-runtime.ts`

`genai-pool.ts` holds the pool selection algorithm (round-robin or weighted
round-robin), per-target health tracking (success/failure counters, cooldown
timestamps, a bounded recent-event ring buffer), and the failover loop that
walks eligible targets on error. `GenAiRuntime` wraps a pool snapshot behind
the same `GenAiClient` shape so `single` mode and `pool` mode are
indistinguishable to callers, and owns `reload()` for hot-swapping the active
snapshot when the admin API mutates credentials.

**Architecture Invariant:** a `GenAiPoolSnapshot` is never mutated into a new
shape -- `reload()` builds an entirely new snapshot (new clients, fresh
health, incremented `version`) and swaps a reference. In-flight requests hold
a `refCount` pin on the snapshot they started with, so a reload can't yank
the pool out from under a request already in `withFailover`.

### `src/strategies/compatibility-strategy.ts` and `src/routes/`

`compatibility-strategy.ts` handles the three route families (`gemini`,
`vertex`, `vtx`) that are near-passthroughs to the gateway's `GenAiClient`
request shape -- it only translates Vertex's `predict` instance format into
`contents`. `src/routes/`
holds the families that need real translation: `openai-compatible-routes.ts`
(Chat Completions), `openai-responses-routes.ts` (Responses API),
`openai-images-routes.ts` and `custom-image-routes.ts` (image generation/edit/
upscale/describe, delegating to `src/workloads/`), and `openai-content.ts`
(the shared OpenAI-content-to-Gemini-parts translator both OpenAI route files
call through a small policy object rather than duplicating the loop).

**Architecture Invariant:** OpenAI Responses deliberately rejects
`background`, `conversation`, `previous_response_id`, `store`, and `audio` --
these are explicit `400` validations, not missing features silently ignored.

### `src/workloads/image-workloads.ts` and `image-normalizer.ts`

`ImageWorkloads` is the per-request-scoped facade for the four image
operations (generate/edit/upscale/describe/validateSession), each building a
Gemini `generateContent` call and running it through a `Semaphore` (bounded
by `upstreamConcurrency`) plus a timeout and a single retry-with-jitter for
transient errors. `image-normalizer.ts` pulls inline image/text parts back
out of the Gemini response shape into a flat `ImageDto[]`.

### `src/http/route-dispatch.ts`

`ROUTE_DISPATCH` is the single table mapping a `RouteFamily` to its enable
check, disabled-message, and handler. `app.ts` looks up an entry and calls
`run()` instead of re-deriving per-family branches inline.

`ROUTE_DISPATCH` (via `resolveRouteDispatch`) is an **API Boundary** between
`app.ts` and the route/strategy modules: `app.ts` only ever sees
`RouteDispatchEntry.run(ctx)` and never imports a route handler directly.

### `src/http/sse-response.ts` and `stream-guards.ts`

`driveSseStream` owns the full SSE lifecycle for a consumer: header priming,
per-chunk idle/max-duration guards (`stream-guards.ts`), client-disconnect
detection, and upstream iterator cleanup on early exit.

**Architecture Invariant:** the first-frame error contract is explicit --
a failure before any bytes have been written surfaces as a thrown error (so
`app.ts` can still send a JSON error body), while a failure after the first
frame is written as an SSE `error` event, since the response is no longer a
valid place to change `content-type`.

### `src/lib/upstream-error-classifier.ts` and `src/http/error-response.ts`

Every thrown error funnels through `toGatewayError`, which classifies raw
upstream error messages (the `@google/genai` SDK doesn't expose structured
error codes) into a fixed `GatewayErrorCode` set by regex on the message
text. `classifyUpstreamError` then layers retry/cooldown/failover policy on
top of that code (e.g. quota and timeout errors fail over; validation errors
never do).

**Architecture Invariant:** classification is regex-on-message, done in one
place -- no other module pattern-matches error text, so the mapping from
"upstream said X" to "gateway does Y" only has to be trusted once.

### `src/app.ts`

The HTTP request handler: builds a `RequestContext` (id, structured logger),
runs CORS, admin routing, docs/health short-circuits, then gateway auth,
route classification, model-alias resolution, stream-admission, and dispatch,
in that order. Owns the `AbortController` wiring that ties client/response
`close`/`error` events to stream cancellation.

**Architecture Invariant:** the request body is read to completion
(`readJsonBody`) before dispatch for every route except the multipart OpenAI
image-edit path -- no route handler streams a request body itself.

### `src/server.ts`

The process entry point: loads config, creates the app, listens, and wires
`SIGTERM`/`SIGINT` to a graceful `server.close()`. This is the only file that
knows the process is meant to run as a long-lived server rather than a
library.

### `src/admin/` (secondary subsystem)

A separate, config-mutating subsystem gated by `enableAdminRoutes` and its
own bearer-token auth (`admin-auth.ts`, deliberately never the same secret as
a gateway key -- see `AGENTS.md`). `admin-routes.ts` implements CRUD over
Vertex pool credentials and the model catalog; `credential-store.ts`
persists that state either as the static config (read-only) or as a
JSON file-store with atomic writes and a backup-and-rollback path on write
failure. Every successful mutation calls `runtime.reload()` so the change
takes effect without a process restart.

**Architecture Invariant:** file-store admin mutations assume a writable,
persistent local disk and are documented as unsupported on Cloud Run -- the
code doesn't detect this itself; it's an operational constraint enforced by
not enabling `enableAdminRoutes` in that deployment target.

## Cross-Cutting Concerns

### Cancellation

Streaming requests are cancellable end-to-end: `app.ts` wires client/response
`close`/`error` events to a shared `AbortController`, `StreamAdmission.acquire`
honors that signal while a request is queued for a per-key concurrency slot,
and `driveSseStream` stops pulling from the upstream iterator and calls
`iterator.return()` once the client disconnects.

### Error Handling

All errors are normalized to `GatewayError` (status, `GatewayErrorCode`,
message, retryable flag) before they reach a response writer. Non-streaming
responses get a JSON envelope (`sendError`); streaming responses get an SSE
`error` event (`writeSseError`) if headers are already sent, otherwise the
error propagates to `app.ts`'s top-level catch so it can still be sent as
JSON. Upstream/SDK errors are classified by message text once
(`upstream-error-classifier.ts`) rather than at each call site.

### Observability

Logging is structured JSON via `console.info`/`console.warn`, always keyed by
an `event` field (e.g. `genai_pool.target_selected`,
`genai_pool.all_targets_cooldown`, `gateway.start`, `request.complete`).
`createRequestContext` attaches a per-request id (from `x-request-id` or a
generated UUID) and redacts field names matching
`/token|key|authorization|base64|data/i` before logging, so request logging
can't accidentally leak a gateway key or an inline image payload.

### Testing

Tests run under Vitest (`test/*.test.ts`), driven by `test-config.ts` -- a
`GatewayConfig` factory with safe defaults (`single` mode, one legacy target)
that every test overrides selectively rather than constructing a config by
hand. Route/strategy tests inject a fake `GenAiClient` (via `genAiFactory` on
`createApp`) instead of hitting the real `@google/genai` SDK, so the test
suite has no network dependency. `scripts/check-node-platform.mjs` runs ahead
of `test`/`compile` to fail fast on cross-OS `node_modules` (e.g. Windows
native binaries checked out on Linux) rather than letting Vitest/tsc fail
with a confusing native-module error.

**Architecture Invariant:** no test depends on real Google credentials or
network access -- every test that reaches a `GenAiClient` does so through an
injected fake.
