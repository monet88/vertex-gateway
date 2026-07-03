# Resilience & Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the gateway's retry/failover/error pipeline — fix SSE framing, OpenAI error mapping, jitter math, resource leaks, stale config, and cross-platform deps.

**Architecture:** Centralize retry logic in `retryWithJitter` with AbortSignal support, refactor pool to use it with fast-failover for TIMEOUT/UNAVAILABLE, standardize all error outputs via `formatOpenAiErrorBody` + masking.

**Tech Stack:** Node.js 22, TypeScript 5.8, Vitest 4, `@google/genai` SDK

## Global Constraints

- All changes backward-compatible — no public API breaks
- `DOMException('Aborted', 'AbortError')` for abort errors (Node 18+ standard)
- `maskSensitiveInfo` applied only at output boundary, never on internal logs
- Run `npx vitest run` after each task to verify no regressions
- Commit after each task with conventional commit prefix

## File Structure

| File | Responsibility | Tasks |
|------|----------------|-------|
| `src/lib/retry.ts` | Retry primitives: backoff, jitter, abort | 1 |
| `src/http/error-response.ts` | Error formatting, masking, `safeErrorMessage` export | 2 |
| `src/http/sse-response.ts` | SSE framing, listener cleanup | 3 |
| `src/lib/upstream-error-classifier.ts` | Error classification, defensive access | 4 |
| `src/lib/genai-pool.ts` | Pool retry refactor, constructor, startedAt fix | 5 |
| `src/lib/genai-runtime.ts` | Lazy config accessor for pool client | 5 |
| `src/app.ts` | Inline type cleanup | 6 |
| `package.json` | Cross-platform optional deps | 6 |
| `test/retry.test.ts` | Retry + jitter + abort tests | 1 |
| `test/simulation-robustness.test.ts` | Pool failover tests | 5 |

---

### Task 1: Full Jitter + AbortSignal in `retry.ts`

**Files:**
- Modify: `src/lib/retry.ts` (full file, 37 lines)
- Modify: `test/retry.test.ts` (full file, 63 lines)

**Interfaces:**
- Produces: `computeBackoffMs(attempt, baseDelayMs)` — returns `Math.floor(Math.random() * exponential)` (range `[0, exponential)`)
- Produces: `retryWithJitter<T>(task, retries, shouldRetry?, baseDelayMs?, signal?)` — new 5th param `signal?: AbortSignal`

- [ ] **Step 1: Update `computeBackoffMs` tests for Full Jitter**

In `test/retry.test.ts`, replace the first test block:

```typescript
describe('computeBackoffMs', () => {
  it('returns a value in the full jitter range [0, exponential)', () => {
    const base = 200;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const cap = Math.min(base * 2 ** attempt, 30_000);
      const value = computeBackoffMs(attempt, base);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(cap);
    }
  });

  it('caps the exponential term', () => {
    const value = computeBackoffMs(20, 250);
    expect(value).toBeLessThan(30_000);
  });

  it('bounds high attempt exponents to prevent overflow', () => {
    const value = computeBackoffMs(1000, 250);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeLessThan(30_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/retry.test.ts`
Expected: FAIL — `computeBackoffMs` still returns `exponential + jitter`, value will exceed `cap`.

- [ ] **Step 3: Implement Full Jitter in `computeBackoffMs`**

In `src/lib/retry.ts`, replace lines 6-15:

```typescript
// Spec §5: exponential backoff + full jitter (standard AWS formula).
// delay = random(0, min(base * 2^attempt, cap)).
// Base default 250ms to avoid thundering herd on Google 429 responses.
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number, baseDelayMs: number): number => {
  const exponential = Math.min(baseDelayMs * 2 ** Math.min(attempt, 20), BACKOFF_CAP_MS);
  return Math.floor(Math.random() * exponential);
};
```

- [ ] **Step 4: Run test to verify backoff tests pass**

Run: `npx vitest run test/retry.test.ts`
Expected: `computeBackoffMs` tests PASS. `retryWithJitter` tests may need update.

- [ ] **Step 5: Add AbortSignal tests for `retryWithJitter`**

Append to `test/retry.test.ts` inside the `retryWithJitter` describe block:

```typescript
  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => 'ok');
    await expect(
      retryWithJitter(task, 3, () => true, 10, controller.signal),
    ).rejects.toThrow('Aborted');
    expect(task).not.toHaveBeenCalled();
  });

  it('throws AbortError when signal aborts during delay', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      throw new Error('503 unavailable');
    });
    const promise = retryWithJitter(task, 3, () => true, 1000, controller.signal);
    // Let first attempt fail and enter delay
    await vi.advanceTimersByTimeAsync(1);
    // Abort during delay
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(calls).toBe(1);
  });

  it('clears timeout when signal aborts during delay', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const task = vi.fn(async () => { throw new Error('503'); });
    const promise = retryWithJitter(task, 3, () => true, 5000, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
```

- [ ] **Step 6: Run test to verify AbortSignal tests fail**

Run: `npx vitest run test/retry.test.ts`
Expected: FAIL — `retryWithJitter` doesn't accept 5th param yet.

- [ ] **Step 7: Implement AbortSignal in `retryWithJitter`**

In `src/lib/retry.ts`, replace the `retryWithJitter` function (lines 17-36):

```typescript
export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry: (error: unknown) => boolean = isTransientError,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
  signal?: AbortSignal,
): Promise<{ value: T; retries: number }> => {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return { value: await task(), retries: attempt };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = computeBackoffMs(attempt, baseDelayMs);
      attempt += 1;
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  }
};
```

- [ ] **Step 8: Update existing `retryWithJitter` test expectations**

The existing "retries transient failures" test expectations remain valid since
Full Jitter doesn't change retry count logic. But verify the test still uses
`baseDelayMs: 10` so delays are small.

- [ ] **Step 9: Run all retry tests to verify pass**

Run: `npx vitest run test/retry.test.ts`
Expected: ALL PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/retry.ts test/retry.test.ts
git commit -m "feat(retry): implement full jitter and AbortSignal support

- computeBackoffMs uses standard full jitter: random(0, exponential)
- retryWithJitter accepts optional AbortSignal (5th param)
- Signal checks before task, after catch, and during delay
- Timer cleared immediately on abort"
```

---

### Task 2: Error Response — OpenAI Mapping + Masking + Export (`error-response.ts`)

**Files:**
- Modify: `src/http/error-response.ts` (lines 50-60, 37-48, 75-86)

**Interfaces:**
- Produces: `formatOpenAiErrorBody(gatewayError)` — returns mapped `{ error: { message, type, code } }`
- Produces: `maskSensitiveInfo(message)` — exported, replaces `projects/xxx` and `locations/xxx`
- Produces: `safeErrorMessage(error)` — exported (was module-private)

- [ ] **Step 1: Update `formatOpenAiErrorBody` with error code mapping**

In `src/http/error-response.ts`, replace lines 50-60:

```typescript
// OpenAI SDK clients expect a bare { error: { message, type, code } } envelope
// with no gateway wrapper. See spec §3.
export const formatOpenAiErrorBody = (
  gatewayError: GatewayError,
): Record<string, unknown> => {
  let type = 'server_error';
  let code: string | null = 'internal_error';
  switch (gatewayError.code) {
    case 'UPSTREAM_QUOTA':
      type = 'requests_error'; code = 'rate_limit_exceeded'; break;
    case 'AUTH_INVALID':
    case 'CORS_DENIED':
      type = 'invalid_request_error'; code = 'invalid_api_key'; break;
    case 'VALIDATION_FAILED':
    case 'PAYLOAD_TOO_LARGE':
      type = 'invalid_request_error'; code = 'invalid_value'; break;
    case 'NOT_FOUND':
      type = 'invalid_request_error'; code = 'model_not_found'; break;
    case 'TIMEOUT':
      type = 'server_error'; code = 'timeout'; break;
    case 'METHOD_NOT_ALLOWED':
    case 'NOT_IMPLEMENTED':
      type = 'invalid_request_error'; code = 'invalid_value'; break;
    // IMAGE_NOT_RETURNED, INTERNAL, UPSTREAM_UNAVAILABLE → default
  }
  return { error: { message: maskSensitiveInfo(gatewayError.message), type, code } };
};
```

- [ ] **Step 2: Add `maskSensitiveInfo` utility**

Add before `formatOpenAiErrorBody` (around line 50):

```typescript
export const maskSensitiveInfo = (message: string): string =>
  message
    .replace(/projects\/[a-z0-9-]+/gi, 'projects/<masked-project>')
    .replace(/locations\/[a-z0-9-]+/gi, 'locations/<masked-location>');
```

- [ ] **Step 3: Apply masking in `formatGatewayErrorBody`**

In `src/http/error-response.ts`, update `formatGatewayErrorBody` (lines 37-48):

```typescript
export const formatGatewayErrorBody = (
  requestId: string,
  gatewayError: GatewayError,
): Record<string, unknown> => ({
  success: false,
  requestId,
  error: {
    code: gatewayError.code,
    message: maskSensitiveInfo(gatewayError.message),
    retryable: gatewayError.retryable || undefined,
  },
});
```

- [ ] **Step 4: Export `safeErrorMessage`**

Change `const safeErrorMessage` to `export const safeErrorMessage` (line 75):

```typescript
export const safeErrorMessage = (error: unknown): string => {
```

No other changes to the function body.

- [ ] **Step 5: Run tests to verify no regressions**

Run: `npx vitest run test/error-response.test.ts`
Expected: ALL PASS (existing tests don't check OpenAI error type/code values,
but verify the function runs without errors).

- [ ] **Step 6: Commit**

```bash
git add src/http/error-response.ts
git commit -m "feat(error): add OpenAI error code mapping, masking, export safeErrorMessage

- formatOpenAiErrorBody maps GatewayErrorCode to OpenAI type/code
- maskSensitiveInfo redacts project/location IDs at output boundary
- safeErrorMessage exported for reuse in upstream-error-classifier"
```

---

### Task 3: SSE Error Framing + Listener Cleanup (`sse-response.ts`)

**Files:**
- Modify: `src/http/sse-response.ts` (lines 66-90, 162-165)

**Interfaces:**
- Consumes: `formatOpenAiErrorBody` from `error-response.ts` (Task 2)
- Consumes: `maskSensitiveInfo` from `error-response.ts` (Task 2)

- [ ] **Step 1: Fix `writeSseError` — remove `event: error` for OpenAI + use `formatOpenAiErrorBody`**

In `src/http/sse-response.ts`, replace lines 66-90:

```typescript
export const writeSseError = async (
  res: ServerResponse,
  error: unknown,
  format: ErrorFormat = 'gateway',
): Promise<'written' | 'closed'> => {
  const gatewayError = toGatewayError(error);
  const payload = format === 'openai'
    ? formatOpenAiErrorBody(gatewayError)
    : {
        error: {
          code: gatewayError.code satisfies GatewayErrorCode,
          message: maskSensitiveInfo(gatewayError.message),
          retryable: gatewayError.retryable || undefined,
        },
      };
  // OpenAI SDKs only parse bare `data:` frames — omit `event: error` prefix.
  // Gateway format retains the `error` event type for custom clients.
  const status = await writeSseJson(res, payload, format === 'openai' ? undefined : 'error');
  if (status === 'written' && !res.destroyed && !res.writableEnded) {
    try {
      res.end();
    } catch {
      return 'closed';
    }
  }
  return status;
};
```

- [ ] **Step 2: Update imports in `sse-response.ts`**

Update line 3 to import `maskSensitiveInfo`:

```typescript
import { GatewayError, toGatewayError, formatOpenAiErrorBody, maskSensitiveInfo } from './error-response.js';
```

- [ ] **Step 3: Add defense-in-depth `onClose` listener cleanup**

In `src/http/sse-response.ts`, replace the `onClose` function (lines 162-165):

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

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/sse-response.ts
git commit -m "fix(sse): correct OpenAI error framing and add listener cleanup

- writeSseError omits event: error for OpenAI format (SDKs only parse data: frames)
- Use formatOpenAiErrorBody for consistent error structure
- Apply maskSensitiveInfo to gateway-format SSE errors
- onClose eagerly removes event listeners (defense-in-depth)"
```

---

### Task 4: Defensive Error Classification (`upstream-error-classifier.ts`)

**Files:**
- Modify: `src/lib/upstream-error-classifier.ts` (lines 16-17, 43-66, 90-104)

**Interfaces:**
- Consumes: `safeErrorMessage` from `error-response.ts` (Task 2)

- [ ] **Step 1: Update `asFiniteInt` to handle string numbers**

In `src/lib/upstream-error-classifier.ts`, replace lines 16-17:

```typescript
const asFiniteInt = (value: unknown): number | undefined => {
  const num = typeof value === 'number' ? value
    : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.trunc(num) : undefined;
};
```

- [ ] **Step 2: Wrap `getErrorStatus` property access in try-catch**

In `src/lib/upstream-error-classifier.ts`, replace lines 43-66:

```typescript
export const getErrorStatus = (error: unknown): number | undefined => {
  if (error instanceof ApiError) {
    const status = asFiniteInt(error.status);
    if (status !== undefined) return status;
  }
  try {
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      const direct = asHttpStatus(record.status) ?? asHttpStatus(record.statusCode) ?? asHttpStatus(record.code);
      if (direct !== undefined) return direct;
      const response = record.response;
      if (response && typeof response === 'object') {
        const nested = asHttpStatus((response as Record<string, unknown>).status)
          ?? asHttpStatus((response as Record<string, unknown>).statusCode);
        if (nested !== undefined) return nested;
      }
      const nestedError = record.error;
      if (nestedError && typeof nestedError === 'object') {
        const duck = asHttpStatus((nestedError as Record<string, unknown>).code)
          ?? asHttpStatus((nestedError as Record<string, unknown>).status);
        if (duck !== undefined) return duck;
      }
    }
  } catch {
    // Property getter threw — fall through to undefined.
  }
  return undefined;
};
```

- [ ] **Step 3: Replace `String(error)` with `safeErrorMessage` in both functions**

Add import at top of file:

```typescript
import { safeErrorMessage } from '../http/error-response.js';
```

Update `classifyUpstreamError` (line 93) and `withClassifiedGatewayError` (line 102):

```typescript
export const classifyUpstreamError = (error: unknown): UpstreamErrorClassification => {
  if (error instanceof GatewayError) return decisionFor(error);
  const status = getErrorStatus(error);
  const message = safeErrorMessage(error);
  const gatewayError = (status !== undefined && gatewayErrorFromStatus(status, message))
    || toGatewayError(error);
  return decisionFor(gatewayError);
};

export const withClassifiedGatewayError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;
  const status = getErrorStatus(error);
  const message = safeErrorMessage(error);
  return (status !== undefined && gatewayErrorFromStatus(status, message)) || toGatewayError(error);
};
```

- [ ] **Step 4: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upstream-error-classifier.ts
git commit -m "fix(classifier): defensive property access, safe string coercion, string status

- Wrap getErrorStatus duck-typing in try-catch for throwing property getters
- Replace String(error) with safeErrorMessage to prevent toString() crashes
- asFiniteInt now handles string numeric values like '429'"
```

---

### Task 5: Pool Retry Refactor + Runtime Lazy Config (`genai-pool.ts`, `genai-runtime.ts`)

**Files:**
- Modify: `src/lib/genai-pool.ts` (constructor L482-487, `withFailover` L547-603, streaming L380-479)
- Modify: `src/lib/genai-runtime.ts` (constructor L40-45)
- Modify: `test/simulation-robustness.test.ts` (update expectations)

**Interfaces:**
- Consumes: `retryWithJitter` with AbortSignal (Task 1)
- Consumes: `classifyUpstreamError` (Task 4)

- [ ] **Step 1: Change `GenAiPoolClient` constructor to lazy config accessor**

In `src/lib/genai-pool.ts`, replace the constructor (lines 482-487):

```typescript
export interface PoolRetryConfig {
  cooldownMs: number;
  upstreamRetries: number;
  upstreamRetryDelayMs: number;
}

export class GenAiPoolClient implements GenAiClient {
  // ... existing models property ...

  constructor(
    private readonly getActiveSnapshot: () => GenAiPoolSnapshot,
    private readonly getRetryConfig: () => PoolRetryConfig,
  ) {}
```

- [ ] **Step 2: Update all internal reads from flat fields to accessor**

Replace throughout `GenAiPoolClient` methods:
- `this.cooldownMs` → `this.getRetryConfig().cooldownMs`
- `this.upstreamRetries` → `this.getRetryConfig().upstreamRetries`
- `this.upstreamRetryDelayMs` → `this.getRetryConfig().upstreamRetryDelayMs`

There are 6 occurrences total (3 per path: non-streaming and streaming).

- [ ] **Step 3: Update `GenAiRuntime` constructor to pass lazy accessor**

In `src/lib/genai-runtime.ts`, replace lines 40-45:

```typescript
    this.client = new GenAiPoolClient(
      () => this.activeSnapshot,
      () => ({
        cooldownMs: this.currentConfig.vertexPoolFailoverCooldownMs,
        upstreamRetries: this.currentConfig.upstreamRetries,
        upstreamRetryDelayMs: this.currentConfig.upstreamRetryDelayMs,
      }),
    );
```

- [ ] **Step 4: Add `retryWithJitter` import to `genai-pool.ts`**

Update the import from `./retry.js` (line 14):

```typescript
import { retryWithJitter, computeBackoffMs } from './retry.js';
```

Note: `computeBackoffMs` import kept — still used by `retryWithJitter` internally, but direct pool usage removed.

Actually, after refactoring, the pool no longer calls `computeBackoffMs` directly. Remove the direct import if unused:

```typescript
import { retryWithJitter } from './retry.js';
```

- [ ] **Step 5: Refactor `withFailover` inner retry loop**

In `src/lib/genai-pool.ts`, replace the inner `for(;;)` loop in `withFailover` (lines 576-599):

```typescript
      const { cooldownMs, upstreamRetries, upstreamRetryDelayMs } = this.getRetryConfig();
      const shouldRetryOnTarget = (error: unknown): boolean => {
        const c = classifyUpstreamError(error);
        if (c.code === 'TIMEOUT' || c.code === 'UPSTREAM_UNAVAILABLE') return false;
        return c.retryable;
      };

      try {
        const { value: response, retries: retryCount } = await retryWithJitter(
          () => execute(target),
          upstreamRetries,
          shouldRetryOnTarget,
          upstreamRetryDelayMs,
          metadata.signal,
        );
        if (retryCount > 0) {
          target.health.retries += retryCount;
          target.health.lastRetryAt = new Date().toISOString();
        }
        markSuccess(target, routeFamily);
        return response;
      } catch (error) {
        const classification = classifyUpstreamError(error);
        markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
        lastError = withClassifiedGatewayError(error);
        if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
          throw lastError;
        }
        // break to outer loop for failover
      }
```

Remove `let attempt = 0;` (line 576) — no longer needed.

- [ ] **Step 6: Refactor streaming first-chunk inner retry loop + fix `startedAt`**

In `src/lib/genai-pool.ts`, replace the inner retry loop in `generateContentStream` (lines 410-471):

```typescript
          const { cooldownMs, upstreamRetries, upstreamRetryDelayMs } = this.getRetryConfig();
          const startedAt = Date.now();
          let iterator: AsyncIterator<Record<string, unknown>> | null = null;

          const shouldRetryOnTarget = (error: unknown): boolean => {
            const c = classifyUpstreamError(error);
            if (c.code === 'TIMEOUT' || c.code === 'UPSTREAM_UNAVAILABLE') return false;
            return c.retryable;
          };

          try {
            const { value: result, retries: retryCount } = await retryWithJitter(
              async () => {
                // Clean up previous attempt's iterator
                if (iterator && typeof iterator.return === 'function') {
                  try { await iterator.return(); } catch { /* ignore cleanup */ }
                }
                iterator = null;

                if (!target.client.models.generateContentStream) {
                  throw new Error('Configured GenAI target does not support generateContentStream.');
                }
                const stream = await target.client.models.generateContentStream(request, metadata);
                iterator = stream[Symbol.asyncIterator]();
                const firstStep = await nextStreamStep(iterator, {
                  idleTimeoutMs: metadata.streamGuard?.idleTimeoutMs ?? 30_000,
                  maxDurationMs: metadata.streamGuard?.maxDurationMs ?? 240_000,
                  startedAt,
                });
                return { iterator, firstStep };
              },
              upstreamRetries,
              shouldRetryOnTarget,
              upstreamRetryDelayMs,
              metadata.signal,
            );

            if (retryCount > 0) {
              target.health.retries += retryCount;
              target.health.lastRetryAt = new Date().toISOString();
            }

            if (result.firstStep.done) {
              markSuccess(target, routeFamily);
              snapshot.refCount -= 1;
              return {
                async *[Symbol.asyncIterator]() {
                  // Upstream completed before yielding content.
                },
              };
            }
            return wrapPinnedStream(
              result.iterator,
              result.firstStep,
              () => markSuccess(target, routeFamily),
              (error) => {
                const classification = classifyUpstreamError(error);
                markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
              },
              () => { snapshot.refCount -= 1; },
            );
          } catch (error) {
            if (iterator && typeof iterator.return === 'function') {
              try { await iterator.return(); } catch { /* ignore cleanup */ }
            }
            const classification = classifyUpstreamError(error);
            markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
            lastError = withClassifiedGatewayError(error);
            if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
              throw lastError;
            }
            break; // failover
          }
```

- [ ] **Step 7: Update simulation tests for immediate failover on TIMEOUT/UNAVAILABLE**

In `test/simulation-robustness.test.ts`, update Case A (503) and Case B (504) expectations.

**Case A non-streaming** — target-a now fails over immediately (0 retries):

```typescript
      expect(response).toEqual({ targetId: 'target-b' });
      // UPSTREAM_UNAVAILABLE → immediate failover, no per-target retries
      expect(calls).toEqual(['target-a', 'target-b']);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      const targetB = snapshot.targets.find((t) => t.id === 'target-b')!.health;

      expect(targetA.failure).toBe(1);
      expect(targetA.retries).toBe(0);
      expect(targetA.status).toBe('cooldown');
      expect(targetB.success).toBe(1);
      expect(targetB.status).toBe('healthy');
```

**Case A streaming** — target-a fails immediately, 1 next + 1 return:

```typescript
      expect(events).toEqual(['chunk:target-b']);
      // UPSTREAM_UNAVAILABLE → immediate failover
      expect(calls).toEqual([
        'next:target-a', 'return:target-a:1',
        'next:target-b', 'next:target-b',
      ]);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.retries).toBe(0);
      expect(targetA.failure).toBe(1);
```

**Case B (TIMEOUT)** — identical pattern to Case A.

**Case C (429 UPSTREAM_QUOTA)** — retries preserved, update backoff values:

```typescript
      // Full jitter: computeBackoffMs(0, 100) → floor(0.5 * 100) = 50ms
      // Full jitter: computeBackoffMs(1, 100) → floor(0.5 * 200) = 100ms
      const timeouts = setTimeoutSpy.mock.calls.map((c) => c[1]);
      expect(timeouts).toContain(50);
      expect(timeouts).toContain(100);
```

- [ ] **Step 8: Update `createGenAiRuntime` call in test helper**

In `test/simulation-robustness.test.ts`, the `testConfig` helper may pass old-style constructor args. Update `poolConfigOverrides`:

The test factory calls `createGenAiRuntime(config, factory)` which calls
`new GenAiRuntime(config, factory)`. The runtime constructor now uses the lazy
accessor pattern, so no test changes needed for the constructor itself. But
verify `testConfig` includes `upstreamRetries` and `upstreamRetryDelayMs`:

```typescript
const poolConfigOverrides = (upstreamRetries: number, upstreamRetryDelayMs = 0) => ({
  runtimeMode: 'pool' as const,
  vertexPoolSelection: 'round-robin' as const,
  vertexPoolFailoverCooldownMs: 60000,
  upstreamRetries,
  upstreamRetryDelayMs,
});
```

This already exists — no change needed.

- [ ] **Step 9: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/genai-pool.ts src/lib/genai-runtime.ts test/simulation-robustness.test.ts
git commit -m "refactor(pool): use retryWithJitter, lazy config, immediate TIMEOUT failover

- GenAiPoolClient constructor takes lazy config accessor (fixes stale-after-reload)
- withFailover and streaming first-chunk use retryWithJitter
- TIMEOUT/UPSTREAM_UNAVAILABLE skip per-target retry, failover immediately
- Streaming startedAt captured once before retry loop (fixes maxDuration reset)
- Update simulation tests for new failover behavior and full jitter backoff"
```

---

### Task 6: Cleanup — `app.ts` Inline Type + Cross-Platform Deps

**Files:**
- Modify: `src/app.ts` (line 89)
- Modify: `package.json` (optionalDependencies)

**Interfaces:**
- None (standalone cleanup)

- [ ] **Step 1: Simplify inline import type in `app.ts`**

In `src/app.ts`, replace line 89:

```typescript
    let errorFormat: 'gateway' | 'openai' = 'gateway';
```

- [ ] **Step 2: Add cross-platform optional dependencies**

In `package.json`, replace the `optionalDependencies` block (lines 28-30):

```json
  "optionalDependencies": {
    "@rollup/rollup-win32-x64-msvc": "^4.62.2",
    "@rollup/rollup-linux-x64-gnu": "^4.62.2",
    "@rollup/rollup-linux-arm64-gnu": "^4.62.2",
    "@esbuild/win32-x64": "^0.28.0",
    "@esbuild/linux-x64": "^0.28.0",
    "@esbuild/linux-arm64": "^0.28.0"
  }
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app.ts package.json
git commit -m "chore: simplify inline type, add cross-platform optional deps

- app.ts: replace import() type with string literal union
- package.json: add rollup/esbuild optional deps for Linux x64/arm64"
```

---

### Task 7: Final Validation

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS, 0 failures.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Build**

Run: `npm run compile`
Expected: Build succeeds.

- [ ] **Step 4: Verify PR review issues resolved**

Checklist of resolved PR review threads:
- [x] #1: `app.ts` inline type simplified (Task 6)
- [x] #5/#9: Runtime reload stale config (Task 5)
- [x] #7: SSE `formatOpenAiErrorBody` consistency (Task 3)
- [x] #10: Cross-platform deps (Task 6)
- [x] #11: Streaming `startedAt` reset (Task 5)
- [x] #12: `asFiniteInt` string status (Task 4)
- [x] #13: `String(error)` crash (Task 4)
- [x] #15: Comment label "full jitter" (Task 1)

Invalid/skipped:
- #2/#3/#4: `message` param removal — intentionally kept
- #8: `docs/model-list.md` — file exists
