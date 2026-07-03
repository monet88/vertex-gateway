# Resilience & Error Handling Improvements

**Date**: 2026-07-02
**Status**: Draft → Review
**Scope**: `retry.ts`, `genai-pool.ts`, `error-response.ts`, `sse-response.ts`,
`upstream-error-classifier.ts`, `genai-runtime.ts`, `app.ts`, `package.json`

---

## Motivation

Audit of the gateway's retry/failover/error pipeline revealed several issues
spanning critical bugs and robustness gaps:

- **SSE error framing** incompatible with OpenAI SDK (client silently drops errors)
- **Hardcoded OpenAI error payloads** prevent client-side error differentiation
- **Resource leak** potential when SSE listeners aren't eagerly cleaned up
- **Bounded jitter** formula (~3% variance at attempt 5) ineffective against thundering herd
- **Dangling timers** when client aborts during retry delay
- **Sequential retry on dead targets** causing up to 90s latency before failover
- **Streaming `startedAt` reset** per retry defeating `maxDurationMs` contract
- **Stale retry config** after hot-reload
- **Unsafe `String(error)`** can crash the error classifier

---

## Section 1: Full Jitter + AbortSignal (`retry.ts`)

### 1.1 Full Jitter in `computeBackoffMs`

**Current**: `exponential + random(0, base)` — nearly deterministic at high attempts.

**New**: Standard Full Jitter — `random(0, exponential)`:

```typescript
export const computeBackoffMs = (attempt: number, baseDelayMs: number): number => {
  const exponential = Math.min(baseDelayMs * 2 ** Math.min(attempt, 20), BACKOFF_CAP_MS);
  return Math.floor(Math.random() * exponential);
};
```

Comment updated from "full jitter" to match the actual algorithm.

### 1.2 AbortSignal support in `retryWithJitter`

Add optional `signal?: AbortSignal` parameter (5th positional):

```typescript
export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry: (error: unknown) => boolean = isTransientError,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
  signal?: AbortSignal,
): Promise<{ value: T; retries: number }> => { ... };
```

**Behavior:**

- Check `signal?.aborted` before each task execution → throw `AbortError`
- Check `signal?.aborted` after catch, before delay → throw `AbortError`
- During `setTimeout` delay: listen for `abort` event with `{ once: true }`,
  `clearTimeout` + reject on abort
- Use `new DOMException('Aborted', 'AbortError')` — standard Web API, Node 18+

---

## Section 2: Pool Retry Refactor (`genai-pool.ts`)

### 2.1 Replace manual `for(;;)` loops with `retryWithJitter`

Both non-streaming `withFailover` (L576-599) and streaming first-chunk
(L414-471) inner retry loops are replaced with `retryWithJitter` calls.

**Custom `shouldRetry` for immediate failover:**

```typescript
const shouldRetryOnTarget = (error: unknown): boolean => {
  const classification = classifyUpstreamError(error);
  if (classification.code === 'TIMEOUT' || classification.code === 'UPSTREAM_UNAVAILABLE') return false;
  return classification.retryable;
};
```

This is a **local function** — does not change `classifyUpstreamError` global
behavior. Only the pool layer decides TIMEOUT/UNAVAILABLE = immediate failover.

`metadata.signal` is passed through to `retryWithJitter` for client-disconnect
abort propagation.

### 2.2 Fix streaming `startedAt` clock reset

**Bug**: `startedAt: Date.now()` inside the retry loop resets the
`maxDurationMs` guard on every attempt. With 4-minute `maxDurationMs` and 3.5
minute attempts, retries run indefinitely.

**Fix**: Capture `startedAt` once before the inner retry loop:

```typescript
const startedAt = Date.now();  // captured once
// Inside retryWithJitter task closure:
const firstStep = await nextStreamStep(iterator, {
  idleTimeoutMs: metadata.streamGuard?.idleTimeoutMs ?? 30_000,
  maxDurationMs: metadata.streamGuard?.maxDurationMs ?? 240_000,
  startedAt,  // shared across retries
});
```

### 2.3 Constructor integration note

> **Important**: Section 8 changes `GenAiPoolClient` constructor from 4 flat
> params to 2 (snapshot accessor + config accessor). All internal references
> like `this.cooldownMs` become `this.getRetryConfig().cooldownMs`,
> `this.upstreamRetries` → `this.getRetryConfig().upstreamRetries`, etc.
> Implementation order: apply Section 8 constructor change first, then
> refactor retry loops (Section 2.1).

### 2.4 Health tracking with `retryWithJitter`

`retryWithJitter` returns `{ value, retries }`. The pool uses `retries` to
update `target.health.retries` and `lastRetryAt`, preserving existing health
tracking behavior.

---

## Section 3: OpenAI Error Mapping + Masking (`error-response.ts`)

### 3.1 Detailed error code mapping in `formatOpenAiErrorBody`

Replace hardcoded `{ type: 'server_error', code: 'internal_error' }` with a
switch on `GatewayErrorCode`:

| GatewayErrorCode | OpenAI `type` | OpenAI `code` |
|------------------|---------------|---------------|
| `UPSTREAM_QUOTA` | `requests_error` | `rate_limit_exceeded` |
| `AUTH_INVALID`, `CORS_DENIED` | `invalid_request_error` | `invalid_api_key` |
| `VALIDATION_FAILED` | `invalid_request_error` | `invalid_value` |
| `NOT_FOUND` | `invalid_request_error` | `model_not_found` |
| `TIMEOUT` | `server_error` | `timeout` |
| `PAYLOAD_TOO_LARGE` | `invalid_request_error` | `invalid_value` |
| `METHOD_NOT_ALLOWED`, `NOT_IMPLEMENTED` | `invalid_request_error` | `invalid_value` |
| All others | `server_error` | `internal_error` |

Note: `RATE_LIMITED` does not exist in `GatewayErrorCode` type — omitted to
avoid TypeScript errors. `UPSTREAM_QUOTA` covers 429.

### 3.2 `maskSensitiveInfo` utility

```typescript
export const maskSensitiveInfo = (message: string): string =>
  message
    .replace(/projects\/[a-z0-9-]+/gi, 'projects/<masked-project>')
    .replace(/locations\/[a-z0-9-]+/gi, 'locations/<masked-location>');
```

Applied **only at output boundary** — in `formatOpenAiErrorBody` and
`formatGatewayErrorBody`. Internal logs retain full info for debugging.

### 3.3 Export `safeErrorMessage`

Currently module-private. Export it for reuse in `upstream-error-classifier.ts`
(see Section 5).

---

## Section 4: SSE Error Framing + Listener Cleanup (`sse-response.ts`)

### 4.1 Remove `event: error` for OpenAI format

OpenAI SDKs (Python, Node) only parse `data:` frames. Custom `event: error`
prefix causes SDKs to silently ignore error frames.

**Change in `writeSseError`:**

```typescript
const status = await writeSseJson(
  res,
  payload,
  format === 'openai' ? undefined : 'error',
);
```

Gateway format retains `event: error`.

### 4.2 Use `formatOpenAiErrorBody` in `writeSseError`

Replace inline `{ type: 'server_error', code: null }` with the canonical
`formatOpenAiErrorBody(gatewayError)` — ensures SSE and non-SSE OpenAI error
responses are consistent.

Gateway format SSE also applies `maskSensitiveInfo`.

### 4.3 Defense-in-depth `onClose` listener cleanup

Add `off()` calls inside `onClose` callback:

```typescript
const onClose = () => {
  closed = true;
  options.req?.off('close', onClose);
  options.req?.off('error', onClose);
  res.off('close', onClose);
  res.off('error', onClose);
  void closeIterator();
};
```

The existing `finally` block retains its cleanup (idempotent double-safety).

---

## Section 5: Defensive Error Classification (`upstream-error-classifier.ts`)

### 5.1 Try-catch around `getErrorStatus` property access

Wrap the duck-typed object property access (L48-64) in try-catch. `ApiError`
check remains outside try-catch (known type, safe).

```typescript
export const getErrorStatus = (error: unknown): number | undefined => {
  if (error instanceof ApiError) {
    const status = asFiniteInt(error.status);
    if (status !== undefined) return status;
  }
  try {
    // duck-typing on unknown objects — property getters may throw
    if (error && typeof error === 'object') { ... }
  } catch {
    // Fall through to undefined
  }
  return undefined;
};
```

### 5.2 Replace `String(error)` with `safeErrorMessage`

In both `classifyUpstreamError` (L93) and `withClassifiedGatewayError` (L102),
replace:

```typescript
const message = error instanceof Error ? error.message : String(error);
```

With:

```typescript
import { safeErrorMessage } from '../http/error-response.js';
// ...
const message = safeErrorMessage(error);
```

This prevents crashes when `error` has a throwing `.toString()`.

---

## Section 6: Testing Strategy

### 6.1 `test/retry.test.ts` updates

| Test | Change |
|------|--------|
| `computeBackoffMs` bounds | Range `[0, exponential)` instead of `[exponential, exponential+base]` |
| `computeBackoffMs` cap | Max = `30_000` (no `+ base`) |
| **New**: AbortSignal cancels delay | Abort after 1ms, verify `AbortError` thrown |
| **New**: AbortSignal pre-aborted | Pass already-aborted signal, verify immediate throw without task execution |
| **New**: AbortSignal clears timer | Verify `clearTimeout` called on abort during delay |

### 6.2 `test/simulation-robustness.test.ts` updates

| Test | Change |
|------|--------|
| Case A (503 UPSTREAM_UNAVAILABLE) | Immediate failover: `calls` = `['target-a', 'target-b']` (0 retries) |
| Case B (504 TIMEOUT) | Immediate failover: `calls` = `['target-a', 'target-b']` (0 retries) |
| Case C (429 UPSTREAM_QUOTA) | Retries preserved. Backoff values change for Full Jitter: 50ms, 100ms (at `Math.random()=0.5`) |
| **New**: AbortSignal propagation | Verify request abort → cleanup without wasted upstream calls |

---

## Section 7: Simplify Inline Type in `app.ts` (PR Review #1)

At line 89, replace verbose inline `import(...)` type with string literal union:

```typescript
// BEFORE
let errorFormat: import('./http/error-response.js').ErrorFormat = 'gateway';
// AFTER
let errorFormat: 'gateway' | 'openai' = 'gateway';
```

Minor cleanup — the `ErrorFormat` type import is already available at the top
of the file but using inline import syntax is unnecessary verbosity.

---

## Section 8: Fix Stale Retry Config After Hot-Reload (PR Review #5/#9)

### Problem

`GenAiPoolClient` constructor captures `cooldownMs`, `upstreamRetries`, and
`upstreamRetryDelayMs` as `private readonly` values. `GenAiRuntime.reload()`
swaps `activeSnapshot` and `currentConfig` but does NOT recreate the client.
After reload, retry params are frozen at original values.

### Fix: Lazy config accessor

Change `GenAiPoolClient` constructor to accept a config accessor closure
(consistent with the existing `getActiveSnapshot` pattern):

```typescript
// genai-pool.ts
constructor(
  private readonly getActiveSnapshot: () => GenAiPoolSnapshot,
  private readonly getRetryConfig: () => {
    cooldownMs: number;
    upstreamRetries: number;
    upstreamRetryDelayMs: number;
  },
) {}
```

All internal reads change from `this.cooldownMs` → `this.getRetryConfig().cooldownMs`.

Runtime constructor:

```typescript
// genai-runtime.ts
this.client = new GenAiPoolClient(
  () => this.activeSnapshot,
  () => ({
    cooldownMs: this.currentConfig.vertexPoolFailoverCooldownMs,
    upstreamRetries: this.currentConfig.upstreamRetries,
    upstreamRetryDelayMs: this.currentConfig.upstreamRetryDelayMs,
  }),
);
```

---

## Section 9: Cross-Platform Optional Dependencies (PR Review #10)

### Problem

Only `@rollup/rollup-win32-x64-msvc` declared. `check-node-platform.mjs`
validates rollup AND esbuild native packages per platform. Docker
(`node:22-bookworm-slim`, Linux x64) will fail the platform check.

### Fix

Add missing `optionalDependencies` for CI/CD and development platforms:

```json
{
  "optionalDependencies": {
    "@rollup/rollup-win32-x64-msvc": "^4.62.2",
    "@rollup/rollup-linux-x64-gnu": "^4.62.2",
    "@rollup/rollup-linux-arm64-gnu": "^4.62.2",
    "@esbuild/win32-x64": "^0.28.0",
    "@esbuild/linux-x64": "^0.28.0",
    "@esbuild/linux-arm64": "^0.28.0"
  }
}
```

Version constraints match existing entries (`rollup ^4.62.2`, esbuild `0.28.0`
per `allowScripts`). ARM64 variants included for completeness (Apple Silicon
via Rosetta, Graviton).

---

## Section 10: `asFiniteInt` String Status Handling (PR Review #12)

### Context

Current `asFiniteInt` only handles `typeof value === 'number'`. Reviewer notes
`status: '429'` (string) would be silently missed.

**Risk**: Theoretical — `@google/genai` ApiError `.status` is always numeric,
and the message-regex fallback in `toGatewayError` catches string status codes.

### Defensive fix (nice-to-have)

```typescript
const asFiniteInt = (value: unknown): number | undefined => {
  const num = typeof value === 'number' ? value
    : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
};
```

One-line change, zero risk, guards against future SDK changes.

---

## Out of Scope

- **PR Review #2/#3/#4** (remove `message` param from `gatewayErrorFromStatus`):
  Invalid — `message` is used by callers and needed for masking pipeline.
- **PR Review #8** (broken `docs/model-list.md`): File exists — reviewer error.
- **Unrelated refactoring**: No changes to routing, auth, or config loading
  beyond what's needed for these fixes.

---

## Files Changed Summary

| File | Sections | Type |
|------|----------|------|
| `src/lib/retry.ts` | 1 | Algorithm change + API extension |
| `src/lib/genai-pool.ts` | 2 | Refactor + bug fix |
| `src/http/error-response.ts` | 3 | New mapping + export |
| `src/http/sse-response.ts` | 4 | Bug fix (SSE framing + cleanup) |
| `src/lib/upstream-error-classifier.ts` | 5, 10 | Defensive hardening |
| `src/app.ts` | 7 | Cleanup |
| `src/lib/genai-runtime.ts` | 8 | Bug fix (stale config) |
| `package.json` | 9 | Cross-platform deps |
| `test/retry.test.ts` | 6 | Test updates |
| `test/simulation-robustness.test.ts` | 6 | Test updates |
