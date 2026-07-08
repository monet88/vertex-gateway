# Spec: Robust Agent Platform Model Integration, Error Handling, and Streaming

**Date**: 2026-07-02  
**Status**: REVISED  
**Author**: Antigravity  
**Revision note**: Revised after detailed code review to resolve critical contract mismatches (OpenAI SSE/JSON error shapes), underspecified config loading, retry boundary details (iterator cleanup, mark timing, single-mode), weak classification, insufficient test plan, backoff rationale, and observability impact.

## Goal

Ensure Vertex Gateway robustly handles model integration, upstream errors (429, 404, 400, 401/403, validation), rate limiting, per-target retry logic with jitter, and Server-Sent Events (SSE) streaming according to Google Cloud Agent Platform standards. Changes must preserve (or improve) compatibility for OpenAI SDK clients on the compatibility surfaces.

## Architecture & Design Decisions

### 1. Configuration Surface

Retry policy parameters are exposed for tuning and testing:

- `upstreamRetries`: integer >= 0 (default: 2). Number of **retries after the initial attempt**. Total attempts on one target = 1 + value. Use 0 to disable inner retries.
- `upstreamRetryDelayMs`: base delay in milliseconds (default: 250).

**Loading precedence** (highest wins):
1. Environment: `GATEWAY_UPSTREAM_RETRIES`, `GATEWAY_UPSTREAM_RETRY_DELAY_MS`
2. Pool overlay JSON (`GATEWAY_POOL_CONFIG_FILE`) and/or base config file
3. Defaults

These values apply to **both** "pool" and "single" runtime modes. In single-target mode the gateway still performs the configured inner retries against the sole target before returning an error.

Add fields to `GatewayConfig` (src/config/env.ts). Validate as non-negative finite integers (0 allowed). Surface resolved values in runtime/health snapshots.

### 2. Error Classification — Single Source of Truth

All status extraction, transient/retryable decisions, and cooldown/failover logic must flow through one place to avoid the previous scattered regex-only logic in `retry.ts`, `upstream-error-classifier.ts`, and `error-response.ts`.

- Add / centralize `getErrorStatus(error: unknown): number | undefined` (recommended location: `src/lib/upstream-error-classifier.ts`).
- Detection priority (first match wins):
  1. `error instanceof ApiError` (from `@google/genai`) and its `.status`
  2. `error.status` / `error.statusCode` / `error.code`
  3. `error.response?.status` / `error.response?.statusCode`
  4. `error.error?.code` and similar duck typing
  5. Message regex (existing `toGatewayError` fallbacks) only as last resort
- `classifyUpstreamError` becomes the single source returning `{ code: GatewayErrorCode, retryable, shouldCooldown, shouldFailover }`.
- Update `isTransientError` and `toGatewayError` to delegate to (or share) the classifier.
- Concrete mappings (examples):
  - 429 / RateLimitError → `UPSTREAM_QUOTA`, retryable=true, cooldown+failover
  - 401/403 → `AUTH_INVALID`, retryable=false, cooldown+failover (no inner retry)
  - 400/422 → `VALIDATION_FAILED`, retryable=false, no cooldown/failover
  - 404 → `NOT_FOUND`
  - 5xx / timeout → appropriate transient code
- This also enables proper handling of SDK typed errors instead of weak message regex.

### 3. Error Reporting Contract (Critical)

The gateway must emit different error envelopes for different route families so that OpenAI-compatible clients continue to work while internal routes keep their existing shape.

**Gateway-native** (gemini / vertex / vtx / images ...):
- JSON: `{ "success": false, "requestId": "...", "error": { "code": "INTERNAL", "message": "...", "retryable": true } }`
- SSE: `event: error\ndata: {"error":{"code":"...","message":"...","retryable":true}}\n\n`

**OpenAI-compatible** (openai-chat / openai-responses):
- Non-stream JSON error: `{ "error": { "message": "...", "type": "server_error", "code": "internal_error" } }` (pure, no success/requestId wrapper)
- SSE error frame: `event: error\ndata: {"error":{"message":"...","type":"server_error","code":null}}\n\n`

Rules:
- `sendError`, `writeSseError`, and `driveSseStream` (via SseStreamWriter) select the formatter using route family (from metadata).
- Errors written from inside OpenAI stream consumers (`writer.writeError(...)`) must follow the OpenAI shape.
- The first-frame contract stays: failures before any frame is written bubble up as JSON; after headers/SSE data has started they become SSE `event: error`.
- All tests that assert gateway shape on OpenAI routes must be updated.

### 4. Jittered Retries & Failover Logic

Implement **inner per-target retries** (using `retryWithJitter`) **before** marking failure, cooldown, or failing over.

**Non-streaming**:
- Wrap the execute call for a chosen target inside `retryWithJitter(execute, upstreamRetries, classify.retryable)`.
- Increment failure counters on every attempt.
- Only when all attempts for the current target are exhausted: `classifyUpstreamError`, `markFailure`, cooldown if needed, then try next target.

**Streaming (`generateContentStream`)**:
- The per-target selection logic must contain an inner retry loop around:
  - `await generateContentStream(...)`
  - obtain iterator
  - `await nextStreamStep(...)` for the **first** chunk
- On transient failure inside the attempt budget for this target:
  - `await iterator?.return()` (cleanup before every retry on same target)
  - backoff
  - retry the same target
- On successful first chunk: `markSuccess(target)`, wrap the iterator (remaining chunks), return to caller.
- Any error **after** the first successful chunk is terminal: it becomes an SSE error frame (shape per §3) via `driveSseStream`. No failover occurs.

**Marking & counters**:
- `markSuccess` only on paths that successfully deliver a response or first chunk.
- `markFailure` + cooldown/failover decision only after a target has used up its full retry budget.
- Always clean up the iterator when abandoning a stream attempt on a target.

**Concurrency**: During the sleep of an inner retry, other requests may still select the target (documented behavior). Acceptable given small retry counts.

Update `GenAiPoolClient.withFailover` and the streaming method, plus `retryWithJitter` signature to accept delay from config.

### 5. Backoff Strategy

- Base default: 250 ms (changed from 100 ms).
- Algorithm: exponential backoff + full jitter.
  Example: `delay = random(0, min(base * 2 ** attempt, 30_000))`
- Rationale: 100 ms linear was too aggressive for Google 429 responses and risked thundering herd. Exponential + jitter is a proven safe default. The cap is a fixed 30_000 ms constant unless a future config surface is introduced.
- `retryWithJitter` must read the configured base delay.
- Future: honor `retry-after` / equivalent from SDK error when present.

The chosen values and algorithm must be explained in code comments referencing this spec.

### 6. Observability, Health, and Component Impact

- Extend health records (`GenAiTargetHealth`) with retry attempt counters or last-retry error info.
- Structured logs for retry attempts and target exhaustion.
- Effective retry config values appear in health / runtime snapshot.
- `probeTarget` (genai-runtime): keep as a lightweight single attempt (or limited retries) for now — document that it bypasses full pool retry logic.
- `driveSseStream`, route handlers, error-response, pool, classifier, env, and tests are in scope.
- Admin, credential loading, and file-store flows are unaffected.

## Verification Plan

### Automated Tests

Run the complete Vitest suite (`npm test`). The following are **required** updates / new tests. Many existing assertions on call counts and error bodies will need adjustment.

**Error classification (new dedicated tests or in error-response / upstream-error-classifier tests)**
- `getErrorStatus` and `classifyUpstreamError` using:
  - SDK-style `ApiError` objects (status 429, 404, 400, 422, 401, 403, 503, 500).
  - Objects with only `.status`, `.response?.status`, or no status field.
  - Plain Errors (fallback path).
- 401/403 (auth) → retryable=false + shouldCooldown + shouldFailover.
- 400/422 (validation) → no retry, no cooldown, no failover.
- 429 + 5xx → retryable=true.

**Retry + failover behavior (genai-pool.test.ts)**
- Update existing "fails over non-streaming..." and streaming first-iterator tests to assert `(1 + upstreamRetries)` invocations on the failing target before failover + markFailure.
- New: transient failure followed by success on the 2nd attempt (non-stream + streaming first chunk) → overall success, no failover, success counter increased, only the failed attempt counted in failures, no cooldown.
- `retries = 0` case: no extra attempts on a target.
- Single runtime mode still performs the configured inner retries against its only target.
- Concurrent requests while one request is inside a retry backoff on a target.

**Streaming iterator lifecycle**
- When the first chunk phase retries on the same target, assert that `iterator.return()` was called once per failed attempt.
- Cleanup still occurs correctly on client disconnect while waiting for first chunk or during backoff.

**Error shape contract (openai-compatible-routes.test.ts + openai-responses + any gemini stream tests)**
- For OpenAI routes:
  - Post-header upstream error inside SSE → `event: error` + OpenAI shape (`type`, `message`), must not contain `"success":false` or the gateway `code` style.
  - Pre-first-frame failure → HTTP JSON response uses pure OpenAI error envelope.
- Update the two tests "keeps post-header upstream errors inside SSE frames" and "returns a regular JSON error when the upstream stream fails before the first SSE frame".
- Gateway-native surfaces (if explicitly tested) keep the existing gateway shape (or explicitly assert the difference).

**Config loading & validation**
- New env vars and values from pool overlay are parsed, validated (>=0 integer), and take precedence correctly.
- Resolved values are visible via runtime snapshot / health endpoints.
- 0 retries is accepted and disables inner retry.

**Other**
- Inside-stream `writeError` calls from OpenAI consumers (tool call validation etc.) produce the correct family shape.
- First-frame contract of `driveSseStream` is preserved (pre-header errors are thrown for JSON handling).
- Exhaustion of all targets after per-target retries still produces the expected terminal error.
- `probeTarget` behavior is documented in tests if it uses different retry semantics.

Update any hard-coded call counts (e.g. `toHaveBeenCalledTimes`) and error body expectations as part of the implementation.

## Post-Implementation & Follow-ups

- Consider adding per-request "retriesUsed" to logs for the robustness feature.
- Future iteration: respect `retry-after` headers when the SDK surfaces them.
- If maintaining two error shapes becomes costly, evaluate a single canonical format with an explicit `error_format` field.
