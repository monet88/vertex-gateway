# Agent Platform Inference Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Vertex Gateway robustly handle upstream errors, per-target jittered retries, failover, and SSE streaming while emitting route-family-correct error envelopes (gateway-native vs OpenAI-compatible).

**Architecture:** Centralize error classification (status extraction + retryable/cooldown/failover decisions) in `upstream-error-classifier.ts`. Add configurable inner per-target retries (`retryWithJitter` with exponential + full jitter) inside `GenAiPoolClient` before any failover. Thread an error-format selector (`gateway` | `openai`) from the request's route family through `sendError`, `driveSseStream`, and the SSE writer so OpenAI SDK clients receive pure OpenAI error envelopes.

**Tech Stack:** TypeScript (ESM, Node >=22), `@google/genai` (exposes `ApiError` with `.status`), Vitest 4, raw `node:http` server.

---

## Decisions locked in (from spec review + user answers)

- **Error format by route family:** the entire `openai` family — including `openaiImageGenerations` / `openaiImageEdits` — emits the **OpenAI** error envelope. Everything else (`gemini`, `vertex`, `vtx`, `custom`, health, and unresolved/pre-classification errors) emits the **gateway-native** envelope.
- **Scope:** all six spec sections (§1 config, §2 classification, §3 error contract, §4 retries/failover, §5 backoff, §6 observability) plus test updates.
- **`retryWithJitter` backward-compat:** existing caller `image-workloads.ts:148` passes `(task, 1)`. New optional 3rd/4th params (`shouldRetry`, `baseDelayMs`) keep that call working unchanged.
- **0 retries must be accepted:** the current `numberEnv` / `assertPositiveNumber` helpers reject `<= 0`. A new non-negative-integer path is required; do NOT route the new config through `numberEnv`.

---

## File Structure

**Config (§1)**
- Modify `src/config/env.ts`: add `upstreamRetries` + `upstreamRetryDelayMs` to `GatewayConfig`, `DEFAULTS`, `GatewayFileConfig`, `validateFileConfig`, and `loadConfig`. Add a `nonNegativeIntEnv` helper + `assertNonNegativeInteger` validator. Surface both in `createDerivedConfig` (inherited via spread — no change needed there beyond confirming).
- Modify `test/test-config.ts`: add the two new fields to the base test config.

**Error format contract (§3)**
- Modify `src/http/error-response.ts`: add `ErrorFormat` type + `formatGatewayErrorBody` / `formatOpenAiErrorBody` helpers; make `sendError` accept an optional `format` arg.
- Modify `src/http/sse-response.ts`: `writeSseError`, `SseStreamWriter.writeError`, `driveSseStream`, and `sendSseStream` accept an `ErrorFormat` and emit the right SSE error frame.
- Modify `src/http/route-dispatch.ts`: expose `errorFormatForFamily(family)` and thread it into stream calls.
- Modify `src/app.ts`: capture route family early, compute `errorFormat`, pass it to `sendError` in the catch block.

**Classification (§2)**
- Modify `src/lib/upstream-error-classifier.ts`: add `getErrorStatus`, rewrite `classifyUpstreamError` to classify from status first (falling back to `toGatewayError`), keep `withClassifiedGatewayError`.
- Modify `src/http/error-response.ts`: `toGatewayError` gains a status-aware fast path (used by both `sendError` and classifier fallback). `isTransientError` in `retry.ts` delegates to the classifier's retryable decision.

**Retries + backoff (§4, §5)**
- Modify `src/lib/retry.ts`: exponential + full jitter, optional `baseDelayMs`, exported constants.
- Modify `src/lib/genai-pool.ts`: inner retry loop in `withFailover` (non-stream) and the streaming first-chunk phase; retry counters on health; accept `upstreamRetries` + `upstreamRetryDelayMs` via constructor.
- Modify `src/lib/genai-runtime.ts`: pass the new config values into `GenAiPoolClient`.

**Observability (§6)**
- Modify `src/lib/genai-pool.ts`: extend `GenAiTargetHealth` with `retries` counter + `lastRetryAt`.
- Modify `src/routes/health-routes.ts`: surface `upstreamRetries` + `upstreamRetryDelayMs` in `readyResponse().limits`.

**Tests**
- `test/env-config.test.ts`, `test/error-response.test.ts` (classification), `test/genai-pool.test.ts` (retry/failover counts), `test/openai-compatible-routes.test.ts` (OpenAI error shape), `test/streaming-routes.test.ts` (gateway-native shape stays), `test/root-routes.test.ts` (readyz limits).

---

## Task 1: Config surface for retry policy (§1)

**Files:**
- Modify: `src/config/env.ts`
- Modify: `test/test-config.ts`
- Test: `test/env-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the end of `describe('gateway config file', ...)` in `test/env-config.test.ts`:

```typescript
  it('defaults upstream retry policy when unset', () => {
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GATEWAY_UPSTREAM_RETRIES;
    delete process.env.GATEWAY_UPSTREAM_RETRY_DELAY_MS;
    process.env.GATEWAY_API_KEYS = 'k1';
    process.env.GOOGLE_GENAI_API_KEY = 'express-key';

    const config = loadConfig();
    expect(config.upstreamRetries).toBe(2);
    expect(config.upstreamRetryDelayMs).toBe(250);
  });

  it('accepts zero upstream retries to disable inner retry', () => {
    process.env.GATEWAY_API_KEYS = 'k1';
    process.env.GOOGLE_GENAI_API_KEY = 'express-key';
    process.env.GATEWAY_UPSTREAM_RETRIES = '0';
    process.env.GATEWAY_UPSTREAM_RETRY_DELAY_MS = '500';

    const config = loadConfig();
    expect(config.upstreamRetries).toBe(0);
    expect(config.upstreamRetryDelayMs).toBe(500);
  });

  it('rejects negative or non-integer upstream retries', () => {
    process.env.GATEWAY_API_KEYS = 'k1';
    process.env.GOOGLE_GENAI_API_KEY = 'express-key';
    process.env.GATEWAY_UPSTREAM_RETRIES = '-1';

    expect(() => loadConfig()).toThrow(/GATEWAY_UPSTREAM_RETRIES/);
  });

  it('reads upstream retry policy from GATEWAY_POOL_CONFIG_FILE overlay', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-pool-'));
    const poolPath = path.join(dir, 'pool.json');
    fs.writeFileSync(poolPath, JSON.stringify({
      upstreamRetries: 3,
      upstreamRetryDelayMs: 400,
      vertexPools: [{ id: 'p1', project: 'proj', location: 'global', apiKey: 'x', weight: 1 }],
    }));
    process.env.GATEWAY_API_KEYS = 'k1';
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;

    const config = loadConfig();
    expect(config.upstreamRetries).toBe(3);
    expect(config.upstreamRetryDelayMs).toBe(400);
  });

  it('lets the env override the pool overlay retry policy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-pool-'));
    const poolPath = path.join(dir, 'pool.json');
    fs.writeFileSync(poolPath, JSON.stringify({
      upstreamRetries: 3,
      upstreamRetryDelayMs: 400,
      vertexPools: [{ id: 'p1', project: 'proj', location: 'global', apiKey: 'x', weight: 1 }],
    }));
    process.env.GATEWAY_API_KEYS = 'k1';
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    process.env.GATEWAY_UPSTREAM_RETRIES = '5';

    const config = loadConfig();
    expect(config.upstreamRetries).toBe(5);
    expect(config.upstreamRetryDelayMs).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/env-config.test.ts`
Expected: FAIL — `config.upstreamRetries` is `undefined`; the negative-value test does not throw.

- [ ] **Step 3: Add fields to `GatewayConfig`**

In `src/config/env.ts`, inside `interface GatewayConfig`, add after `vertexPoolFailoverCooldownMs: number;` (line ~51):

```typescript
  upstreamRetries: number;
  upstreamRetryDelayMs: number;
```

- [ ] **Step 4: Add defaults**

In `const DEFAULTS = {...}` add after `vertexPoolFailoverCooldownMs: 60_000,`:

```typescript
  upstreamRetries: 2,
  upstreamRetryDelayMs: 250,
```

- [ ] **Step 5: Allow the fields in file config + pool overlay types**

In `type GatewayFileConfig = Partial<{...}>` add:

```typescript
  upstreamRetries: number;
  upstreamRetryDelayMs: number;
```

In `type GatewayPoolOverlayConfig = Partial<{...}>` add:

```typescript
  upstreamRetries: number;
  upstreamRetryDelayMs: number;
```

- [ ] **Step 6: Add a non-negative-integer validator + env helper**

In `src/config/env.ts`, after `assertPositiveNumber` (line ~258), add:

```typescript
const assertNonNegativeInteger = (
  config: Record<string, unknown>,
  key: string,
  filePath: string,
): void => {
  const value = config[key];
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${filePath}: ${key} must be a non-negative integer.`);
  }
};
```

After `numberEnv` (line ~620), add:

```typescript
// Retry counts/delays legitimately allow 0 (disable inner retry), so they cannot
// reuse numberEnv, which rejects <= 0. See spec §1.
const nonNegativeIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer.`);
  }
  return value;
};
```

- [ ] **Step 7: Validate overlay + file values**

In `validatePoolOverlayConfig`, before the `return normalized;`, add:

```typescript
  assertNonNegativeInteger(config, 'upstreamRetries', filePath);
  assertNonNegativeInteger(config, 'upstreamRetryDelayMs', filePath);
  normalized.upstreamRetries = config.upstreamRetries as number | undefined;
  normalized.upstreamRetryDelayMs = config.upstreamRetryDelayMs as number | undefined;
```

In `validateFileConfig`, after the `assertPositiveNumber` loop, add:

```typescript
  assertNonNegativeInteger(config, 'upstreamRetries', filePath);
  assertNonNegativeInteger(config, 'upstreamRetryDelayMs', filePath);
```

Note: `upstreamRetryDelayMs` allows 0 per the non-negative rule; a 0 delay simply removes the backoff sleep. This is intentional and matches "0 disables inner retry" semantics being about `upstreamRetries`, not the delay.

- [ ] **Step 8: Resolve values in `loadConfig`**

In the `config` object literal in `loadConfig`, after `vertexPoolFailoverCooldownMs: numberEnv(...)`, add:

```typescript
    upstreamRetries: nonNegativeIntEnv(
      'GATEWAY_UPSTREAM_RETRIES',
      poolOverlay.upstreamRetries ??
        fileConfig.upstreamRetries ??
        DEFAULTS.upstreamRetries,
    ),
    upstreamRetryDelayMs: nonNegativeIntEnv(
      'GATEWAY_UPSTREAM_RETRY_DELAY_MS',
      poolOverlay.upstreamRetryDelayMs ??
        fileConfig.upstreamRetryDelayMs ??
        DEFAULTS.upstreamRetryDelayMs,
    ),
```

- [ ] **Step 9: Add fields to `test/test-config.ts`**

In `test/test-config.ts`, after `vertexPoolFailoverCooldownMs: 60_000,`, add:

```typescript
  upstreamRetries: 2,
  upstreamRetryDelayMs: 250,
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test -- test/env-config.test.ts`
Expected: PASS (all new + existing config tests green).

- [ ] **Step 11: Commit**

```bash
git add src/config/env.ts test/test-config.ts test/env-config.test.ts
git commit -m "feat(config): add upstreamRetries and upstreamRetryDelayMs policy"
```

---

## Task 2: Status-aware error classification (§2)

**Files:**
- Modify: `src/http/error-response.ts`
- Modify: `src/lib/upstream-error-classifier.ts`
- Modify: `src/lib/retry.ts`
- Test: `test/error-response.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/error-response.test.ts`:

```typescript
import { ApiError } from '@google/genai';
import { getErrorStatus, classifyUpstreamError } from '../src/lib/upstream-error-classifier.js';

describe('getErrorStatus', () => {
  it('reads status from a @google/genai ApiError', () => {
    const error = new ApiError({ message: 'quota', status: 429 });
    expect(getErrorStatus(error)).toBe(429);
  });

  it('reads a plain .status field', () => {
    expect(getErrorStatus({ status: 404 })).toBe(404);
  });

  it('reads .statusCode and .code fields', () => {
    expect(getErrorStatus({ statusCode: 503 })).toBe(503);
    expect(getErrorStatus({ code: 400 })).toBe(400);
  });

  it('reads a nested .response.status field', () => {
    expect(getErrorStatus({ response: { status: 401 } })).toBe(401);
  });

  it('reads .error.code duck-typed status', () => {
    expect(getErrorStatus({ error: { code: 422 } })).toBe(422);
  });

  it('returns undefined when no status is present', () => {
    expect(getErrorStatus(new Error('mystery'))).toBeUndefined();
    expect(getErrorStatus('plain string')).toBeUndefined();
  });
});

describe('classifyUpstreamError status mapping', () => {
  it('maps 429 to retryable quota with cooldown + failover', () => {
    const c = classifyUpstreamError(new ApiError({ message: 'x', status: 429 }));
    expect(c.code).toBe('UPSTREAM_QUOTA');
    expect(c).toMatchObject({ retryable: true, shouldCooldown: true, shouldFailover: true });
  });

  it('maps 401/403 to non-retryable auth with cooldown + failover', () => {
    for (const status of [401, 403]) {
      const c = classifyUpstreamError({ status });
      expect(c.code).toBe('AUTH_INVALID');
      expect(c).toMatchObject({ retryable: false, shouldCooldown: true, shouldFailover: true });
    }
  });

  it('maps 400/422 to validation with no retry, no cooldown, no failover', () => {
    for (const status of [400, 422]) {
      const c = classifyUpstreamError({ status });
      expect(c.code).toBe('VALIDATION_FAILED');
      expect(c).toMatchObject({ retryable: false, shouldCooldown: false, shouldFailover: false });
    }
  });

  it('maps 404 to not-found', () => {
    expect(classifyUpstreamError({ status: 404 }).code).toBe('NOT_FOUND');
  });

  it('maps 500/503 to retryable transient', () => {
    for (const status of [500, 503]) {
      const c = classifyUpstreamError({ status });
      expect(c.retryable).toBe(true);
    }
  });

  it('falls back to message regex when no status is present', () => {
    const c = classifyUpstreamError(new Error('429 resource_exhausted'));
    expect(c.code).toBe('UPSTREAM_QUOTA');
    expect(c.retryable).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/error-response.test.ts`
Expected: FAIL — `getErrorStatus` is not exported; 422 currently maps via `toGatewayError` (unhandled → INTERNAL).

- [ ] **Step 3: Add a status-aware fast path to `toGatewayError`**

In `src/http/error-response.ts`, add a helper above `toGatewayError` and a `gatewayErrorFromStatus` export. Insert after `safeErrorMessage`:

```typescript
export const gatewayErrorFromStatus = (
  status: number,
  message: string,
): GatewayError | undefined => {
  if (status === 404) {
    return new GatewayError(404, 'NOT_FOUND', 'Upstream model or route was not found.');
  }
  if (status === 400 || status === 422) {
    return new GatewayError(400, 'VALIDATION_FAILED', 'Upstream request was rejected as invalid.');
  }
  if (status === 401 || status === 403) {
    return new GatewayError(401, 'AUTH_INVALID', 'Upstream authentication failed.');
  }
  if (status === 429) {
    return new GatewayError(429, 'UPSTREAM_QUOTA', 'Upstream quota exhausted.', true);
  }
  if (status === 408 || status === 504) {
    return new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
  }
  if (status >= 500) {
    return new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Upstream service is unavailable.', true);
  }
  return undefined;
};
```

- [ ] **Step 4: Add `getErrorStatus` + rewrite `classifyUpstreamError`**

Replace the contents of `src/lib/upstream-error-classifier.ts` with:

```typescript
import { ApiError } from '@google/genai';
import {
  GatewayError,
  gatewayErrorFromStatus,
  toGatewayError,
  type GatewayErrorCode,
} from '../http/error-response.js';

export interface UpstreamErrorClassification {
  code: GatewayErrorCode;
  retryable: boolean;
  shouldCooldown: boolean;
  shouldFailover: boolean;
}

const asFiniteInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Single source of truth for pulling an HTTP status out of an unknown upstream
 * error. Detection priority (first match wins) per spec §2:
 *   1. @google/genai ApiError.status
 *   2. error.status / error.statusCode / error.code
 *   3. error.response?.status / error.response?.statusCode
 *   4. error.error?.code (duck typing)
 * Message-regex extraction is intentionally left to toGatewayError as a last
 * resort inside classifyUpstreamError.
 */
export const getErrorStatus = (error: unknown): number | undefined => {
  if (error instanceof ApiError) {
    const status = asFiniteInt(error.status);
    if (status !== undefined) return status;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const direct = asFiniteInt(record.status) ?? asFiniteInt(record.statusCode) ?? asFiniteInt(record.code);
    if (direct !== undefined) return direct;
    const response = record.response;
    if (response && typeof response === 'object') {
      const nested = asFiniteInt((response as Record<string, unknown>).status)
        ?? asFiniteInt((response as Record<string, unknown>).statusCode);
      if (nested !== undefined) return nested;
    }
    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const duck = asFiniteInt((nestedError as Record<string, unknown>).code)
        ?? asFiniteInt((nestedError as Record<string, unknown>).status);
      if (duck !== undefined) return duck;
    }
  }
  return undefined;
};

const decisionFor = (gatewayError: GatewayError): UpstreamErrorClassification => {
  if (gatewayError.code === 'VALIDATION_FAILED' || gatewayError.code === 'PAYLOAD_TOO_LARGE') {
    return { code: gatewayError.code, retryable: false, shouldCooldown: false, shouldFailover: false };
  }
  if (gatewayError.code === 'AUTH_INVALID') {
    return { code: gatewayError.code, retryable: false, shouldCooldown: true, shouldFailover: true };
  }
  if (
    gatewayError.code === 'UPSTREAM_QUOTA'
    || gatewayError.code === 'UPSTREAM_UNAVAILABLE'
    || gatewayError.code === 'TIMEOUT'
  ) {
    return { code: gatewayError.code, retryable: true, shouldCooldown: true, shouldFailover: true };
  }
  return {
    code: gatewayError.code,
    retryable: gatewayError.retryable,
    shouldCooldown: gatewayError.retryable,
    shouldFailover: gatewayError.retryable,
  };
};

export const classifyUpstreamError = (error: unknown): UpstreamErrorClassification => {
  if (error instanceof GatewayError) return decisionFor(error);
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const gatewayError = (status !== undefined && gatewayErrorFromStatus(status, message))
    || toGatewayError(error);
  return decisionFor(gatewayError);
};

export const withClassifiedGatewayError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (status !== undefined && gatewayErrorFromStatus(status, message)) || toGatewayError(error);
};
```

- [ ] **Step 5: Delegate `isTransientError` to the classifier**

Replace `isTransientError` in `src/lib/retry.ts` with:

```typescript
import { classifyUpstreamError } from './upstream-error-classifier.js';

export const isTransientError = (error: unknown): boolean =>
  classifyUpstreamError(error).retryable;
```

(Leave `retryWithJitter` untouched in this task — Task 5 rewrites it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/error-response.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full classification-adjacent suite**

Run: `npm test -- test/genai-pool.test.ts test/error-response.test.ts`
Expected: PASS (no regressions from the classifier rewrite).

- [ ] **Step 8: Commit**

```bash
git add src/http/error-response.ts src/lib/upstream-error-classifier.ts src/lib/retry.ts test/error-response.test.ts
git commit -m "feat(classifier): status-first upstream error classification"
```

---

## Task 3: Route-family error envelopes (§3)

**Files:**
- Modify: `src/http/error-response.ts`
- Modify: `src/http/sse-response.ts`
- Modify: `src/http/route-dispatch.ts`
- Modify: `src/app.ts`
- Test: `test/openai-compatible-routes.test.ts`, `test/streaming-routes.test.ts`

- [ ] **Step 1: Write / update the failing tests**

In `test/openai-compatible-routes.test.ts`, update the "keeps post-header upstream errors inside SSE frames" test body assertions (currently lines ~387-392) to:

```typescript
    expect(response.status).toBe(200);
    expect(body).toContain('event: error');
    expect(body).toContain('"type":"server_error"');
    expect(body).toContain('"message":"Internal gateway error."');
    expect(body).not.toContain('sk-live-secret');
    expect(body).not.toContain('/tmp/path');
    expect(body).not.toContain('"success":false');
    expect(body).not.toContain('"code":"INTERNAL"');
```

Update the "returns a regular JSON error when the upstream stream fails before the first SSE frame" test's body assertions to the pure OpenAI envelope:

```typescript
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.type).toBe('server_error');
    expect(body.error.message).toBe('Internal gateway error.');
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
```

Add a new test asserting the non-stream OpenAI JSON error shape (place inside the existing top-level `describe`):

```typescript
  it('returns a pure OpenAI error envelope for non-stream chat failures', async () => {
    const generateContent = vi.fn(async () => { throw new Error('429 resource_exhausted'); });
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream: vi.fn() } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.type).toBe('server_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });
```

In `test/streaming-routes.test.ts`, the gemini idle-timeout test asserts `"code":"TIMEOUT"` (gateway-native) — this stays correct because gemini is gateway-native. Add an explicit guard right after that assertion (line ~209):

```typescript
      expect(body).not.toContain('"type":"server_error"');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/openai-compatible-routes.test.ts`
Expected: FAIL — current code writes gateway-native `"code":"INTERNAL"` / `"success":false` shapes on OpenAI routes.

- [ ] **Step 3: Add error-format formatters + `format` arg to `sendError`**

In `src/http/error-response.ts`, add after the `GatewayErrorCode` type:

```typescript
export type ErrorFormat = 'gateway' | 'openai';
```

Add formatter helpers before `sendError`:

```typescript
export const formatGatewayErrorBody = (
  requestId: string,
  gatewayError: GatewayError,
): Record<string, unknown> => ({
  success: false,
  requestId,
  error: {
    code: gatewayError.code,
    message: gatewayError.message,
    retryable: gatewayError.retryable || undefined,
  },
});

// OpenAI SDK clients expect a bare { error: { message, type, code } } envelope
// with no gateway wrapper. See spec §3.
export const formatOpenAiErrorBody = (
  gatewayError: GatewayError,
): Record<string, unknown> => ({
  error: {
    message: gatewayError.message,
    type: 'server_error',
    code: 'internal_error',
  },
});
```

Replace `sendError` with:

```typescript
export const sendError = (
  res: ServerResponse,
  requestId: string,
  error: unknown,
  format: ErrorFormat = 'gateway',
): void => {
  const gatewayError = toGatewayError(error);
  const body = format === 'openai'
    ? formatOpenAiErrorBody(gatewayError)
    : formatGatewayErrorBody(requestId, gatewayError);
  sendJson(res, gatewayError.status, body);
};
```

- [ ] **Step 4: Thread `ErrorFormat` through the SSE writer**

In `src/http/sse-response.ts`, import the formatters + type:

```typescript
import { GatewayError, toGatewayError, formatOpenAiErrorBody, type ErrorFormat } from './error-response.js';
```

Replace `writeSseError` with a format-aware version:

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
          message: gatewayError.message,
          retryable: gatewayError.retryable || undefined,
        },
      };
  const status = await writeSseJson(res, payload, 'error');
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

The OpenAI SSE frame code is `null` per spec, but `formatOpenAiErrorBody` uses `code: 'internal_error'` for JSON. To honor the spec's SSE-vs-JSON code distinction, give the SSE path its own inline payload instead of reusing the JSON formatter. Replace the `format === 'openai'` branch above with:

```typescript
  const payload = format === 'openai'
    ? { error: { message: gatewayError.message, type: 'server_error', code: null } }
    : {
        error: {
          code: gatewayError.code satisfies GatewayErrorCode,
          message: gatewayError.message,
          retryable: gatewayError.retryable || undefined,
        },
      };
```

- [ ] **Step 5: Pass `ErrorFormat` into `driveSseStream` + `SseStreamWriter`**

In `src/http/sse-response.ts`:

Extend `SseStreamDriveOptions`:

```typescript
export interface SseStreamDriveOptions {
  idleTimeoutMs?: number;
  maxDurationMs?: number;
  req?: IncomingMessage;
  errorFormat?: ErrorFormat;
}
```

Inside `driveSseStream`, read it:

```typescript
  const errorFormat = options.errorFormat ?? 'gateway';
```

Update the writer's `writeError`:

```typescript
    writeError: async (error) => {
      wroteFrame = true;
      await writeSseError(res, error, errorFormat);
    },
```

Extend `sendSseStream` options + pass-through:

```typescript
export const sendSseStream = async (
  res: ServerResponse,
  chunks: AsyncIterable<Record<string, unknown>>,
  options: { includeDone?: boolean; idleTimeoutMs?: number; maxDurationMs?: number; req?: IncomingMessage; errorFormat?: ErrorFormat } = {},
): Promise<void> => {
  const includeDone = options.includeDone ?? false;
  await driveSseStream(
    res,
    chunks,
    {
      onChunk: async (chunk, _index, writer) => (
        await writer.writeJson(chunk) === 'closed' ? 'stop' : 'continue'
      ),
      onComplete: (writer) => {
        if (includeDone) {
          writer.writeDone();
        } else {
          writer.end();
        }
      },
    },
    {
      req: options.req,
      idleTimeoutMs: options.idleTimeoutMs,
      maxDurationMs: options.maxDurationMs,
      errorFormat: options.errorFormat,
    },
  );
};
```

- [ ] **Step 6: Add `errorFormatForFamily` + thread it into dispatch stream calls**

In `src/http/route-dispatch.ts`, import the type:

```typescript
import { sendJson } from './error-response.js';
import type { ErrorFormat } from './error-response.js';
```

Add after the imports:

```typescript
export const errorFormatForFamily = (family: RouteFamily): ErrorFormat =>
  family === 'openai' ? 'openai' : 'gateway';
```

The OpenAI stream handlers (`runOpenAiCompatibleStreamRoute`, `runOpenAiResponsesStreamRoute`) call `driveSseStream` directly. Add an `errorFormat: 'openai'` option to those two `driveSseStream` calls (see Step 7). For the gemini/vertex compatibility family, `runCompatibilityFamily` calls `sendSseStream` — pass `errorFormat: errorFormatForFamily(ctx.route.family)`:

```typescript
const runCompatibilityFamily = (
  runSync: (ctx: RouteContext) => Promise<Record<string, unknown>>,
) => async (ctx: RouteContext): Promise<void> => {
  if (ctx.route.stream) {
    await sendSseStream(
      ctx.res,
      await runCompatibilityStreamRoute(ctx.route, ctx.body, ctx.ai, ctx.requestId, ctx.streamConfig),
      { includeDone: false, req: ctx.req, ...ctx.streamConfig, errorFormat: errorFormatForFamily(ctx.route.family) },
    );
    return;
  }
  sendJson(ctx.res, 200, await runSync(ctx));
};
```

- [ ] **Step 7: Set `errorFormat: 'openai'` on the OpenAI stream drivers**

In `src/routes/openai-compatible-routes.ts`, the final `driveSseStream` options object (line ~391) becomes:

```typescript
  }, { req, idleTimeoutMs: streamConfig.idleTimeoutMs, maxDurationMs: streamConfig.maxDurationMs, errorFormat: 'openai' });
```

In `src/routes/openai-responses-routes.ts`, the final `driveSseStream` options object (line ~472) becomes:

```typescript
  }, { req, idleTimeoutMs: streamConfig.idleTimeoutMs, maxDurationMs: streamConfig.maxDurationMs, errorFormat: 'openai' });
```

- [ ] **Step 8: Capture family + pass format in `app.ts` catch block**

In `src/app.ts`, import `errorFormatForFamily`:

```typescript
import { isStreamingRequest, resolveRouteDispatch, errorFormatForFamily } from './http/route-dispatch.js';
```

Declare a mutable format holder at the top of the request handler `try` block, right after `const ctx = createRequestContext(req, res);`:

```typescript
    let errorFormat: import('./http/error-response.js').ErrorFormat = 'gateway';
```

After `const route = classifyRoute(...)` (line ~129), set it:

```typescript
      errorFormat = errorFormatForFamily(route.family);
```

In the catch block, change `sendError(res, ctx.id, error);` (line ~229) to:

```typescript
      sendError(res, ctx.id, error, errorFormat);
```

Note: pre-classification errors (bad URL, CORS, admin) keep `errorFormat = 'gateway'` since `route` is not yet resolved — this matches the spec's rule that errors before family resolution use the gateway shape.

- [ ] **Step 9: Run the contract tests to verify they pass**

Run: `npm test -- test/openai-compatible-routes.test.ts test/openai-responses-routes.test.ts test/streaming-routes.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite to catch shape regressions elsewhere**

Run: `npm test`
Expected: PASS. If any gateway-native test now fails on OpenAI routes, update it to the OpenAI shape; if an OpenAI test asserted gateway shape it was already updated above.

- [ ] **Step 11: Commit**

```bash
git add src/http/error-response.ts src/http/sse-response.ts src/http/route-dispatch.ts src/app.ts src/routes/openai-compatible-routes.ts src/routes/openai-responses-routes.ts test/openai-compatible-routes.test.ts test/streaming-routes.test.ts
git commit -m "feat(errors): route-family-aware error envelopes (openai vs gateway)"
```

---

## Task 4: Exponential + full jitter backoff (§5)

**Files:**
- Modify: `src/lib/retry.ts`
- Test: `test/retry.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/retry.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { retryWithJitter, computeBackoffMs, DEFAULT_RETRY_BASE_DELAY_MS } from '../src/lib/retry.js';

describe('computeBackoffMs', () => {
  it('is exponential plus full jitter bounded by base', () => {
    const base = 200;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const min = Math.min(base * 2 ** attempt, 30_000);
      const value = computeBackoffMs(attempt, base);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(min + base);
    }
  });

  it('caps the exponential term', () => {
    const value = computeBackoffMs(20, 250);
    expect(value).toBeLessThanOrEqual(30_000 + 250);
  });
});

describe('retryWithJitter', () => {
  it('retries transient failures then succeeds and reports attempt count', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('503 unavailable');
      return 'ok';
    });
    const promise = retryWithJitter(task, 3, () => true, 10);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ value: 'ok', retries: 2 });
    expect(task).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry when retries is 0', async () => {
    const task = vi.fn(async () => { throw new Error('503 unavailable'); });
    await expect(retryWithJitter(task, 0, () => true, 10)).rejects.toThrow('503 unavailable');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not retry when shouldRetry is false', async () => {
    const task = vi.fn(async () => { throw new Error('400 bad request'); });
    await expect(retryWithJitter(task, 3, () => false, 10)).rejects.toThrow('400 bad request');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defaults base delay to the documented constant', () => {
    expect(DEFAULT_RETRY_BASE_DELAY_MS).toBe(250);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/retry.test.ts`
Expected: FAIL — `computeBackoffMs` / `DEFAULT_RETRY_BASE_DELAY_MS` not exported; signature lacks `baseDelayMs`.

- [ ] **Step 3: Rewrite `retry.ts`**

Replace the whole `src/lib/retry.ts` with:

```typescript
import { classifyUpstreamError } from './upstream-error-classifier.js';

export const isTransientError = (error: unknown): boolean =>
  classifyUpstreamError(error).retryable;

// Spec §5: exponential backoff + full jitter. Base default raised from 100ms to
// 250ms because 100ms linear was too aggressive for Google 429 responses and
// risked a thundering herd. delay = min(base * 2**attempt, cap) + random(0, base).
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number, baseDelayMs: number): number => {
  const exponential = Math.min(baseDelayMs * 2 ** attempt, BACKOFF_CAP_MS);
  return exponential + Math.floor(Math.random() * baseDelayMs);
};

export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry: (error: unknown) => boolean = isTransientError,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
): Promise<{ value: T; retries: number }> => {
  let attempt = 0;
  for (;;) {
    try {
      return { value: await task(), retries: attempt };
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = computeBackoffMs(attempt, baseDelayMs);
      attempt += 1;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the existing caller still compiles**

`image-workloads.ts:148` calls `retryWithJitter(() => ..., 1)` — the new optional params keep this valid. Run:

Run: `npm test -- test/openai-images-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/retry.ts test/retry.test.ts
git commit -m "feat(retry): exponential backoff with full jitter and configurable base"
```

---

## Task 5: Inner per-target retries in the pool (§4, §6)

**Files:**
- Modify: `src/lib/genai-pool.ts`
- Modify: `src/lib/genai-runtime.ts`
- Test: `test/genai-pool.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/genai-pool.test.ts`, add a shared helper near the top (after imports) if not already present:

```typescript
const poolConfigOverrides = (upstreamRetries: number) => ({
  runtimeMode: 'pool' as const,
  vertexPoolSelection: 'round-robin' as const,
  vertexPoolFailoverCooldownMs: 60000,
  upstreamRetries,
  upstreamRetryDelayMs: 0,
});
```

Add these tests inside the top-level `describe`:

```typescript
  it('retries the same target before failing over (non-streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(2),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') throw new Error('429 quota exceeded');
          return { targetId: target.id };
        }),
      },
    }));

    const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' }, { routeFamily: 'openai-chat' });

    expect(response).toEqual({ targetId: 'project-b' });
    // project-a attempted 1 + 2 retries = 3 times, then failover to project-b once.
    expect(calls).toEqual(['project-a', 'project-a', 'project-a', 'project-b']);
    const snapshot = runtime.getSnapshot().active;
    const a = snapshot.targets.find((t) => t.id === 'project-a')!.health;
    expect(a.failure).toBe(1);
    expect(a.retries).toBe(2);
    expect(a.status).toBe('cooldown');
  });

  it('recovers on the second attempt without failover or cooldown (non-streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(2),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => {
      let attempt = 0;
      return {
        models: {
          generateContent: vi.fn(async () => {
            attempt += 1;
            calls.push(`${target.id}:${attempt}`);
            if (attempt === 1) throw new Error('503 unavailable');
            return { targetId: target.id };
          }),
        },
      };
    });

    const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(response).toEqual({ targetId: 'project-a' });
    expect(calls).toEqual(['project-a:1', 'project-a:2']);
    const a = runtime.getSnapshot().active.targets[0].health;
    expect(a.success).toBe(1);
    expect(a.failure).toBe(0);
    expect(a.retries).toBe(1);
    expect(a.status).toBe('healthy');
  });

  it('does not add retries when upstreamRetries is 0', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(0),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') throw new Error('429 quota exceeded');
          return { targetId: target.id };
        }),
      },
    }));

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    expect(calls).toEqual(['project-a', 'project-b']);
    expect(runtime.getSnapshot().active.targets.find((t) => t.id === 'project-a')!.health.retries).toBe(0);
  });

  it('retries the same target on first-chunk failure before failover (streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(1),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => {
      let returnCount = 0;
      return {
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => ({
            [Symbol.asyncIterator]() {
              let yielded = false;
              return {
                next: async () => {
                  calls.push(`next:${target.id}`);
                  if (target.id === 'project-a') throw new Error('503 unavailable');
                  if (yielded) return { done: true, value: undefined };
                  yielded = true;
                  return { done: false, value: { event: `chunk:${target.id}` } };
                },
                return: async () => {
                  returnCount += 1;
                  calls.push(`return:${target.id}:${returnCount}`);
                  return { done: true, value: undefined };
                },
              };
            },
          })),
        },
      };
    });

    const stream = await runtime.client.models.generateContentStream?.({ model: 'gemini-2.5-flash' }, {
      routeFamily: 'openai-responses',
      streamGuard: { idleTimeoutMs: 250, maxDurationMs: 10000 },
    });
    const events: string[] = [];
    for await (const chunk of stream ?? []) events.push(String(chunk.event));

    expect(events).toEqual(['chunk:project-b']);
    // project-a: attempt 1 (next+return), retry attempt 2 (next+return), then failover.
    expect(calls).toEqual([
      'next:project-a', 'return:project-a:1',
      'next:project-a', 'return:project-a:2',
      'next:project-b', 'next:project-b',
    ]);
    const a = runtime.getSnapshot().active.targets.find((t) => t.id === 'project-a')!.health;
    expect(a.retries).toBe(1);
    expect(a.failure).toBe(1);
  });
```

Update the existing "fails over streaming when the first iterator.next rejects..." test (line ~830). With the default `upstreamRetries` of 2 (from `testConfig`), project-a now retries. Set `upstreamRetries: 0` in that test's config override so its `expect(calls).toEqual(['next:project-a', 'next:project-b', 'next:project-b'])` stays valid. Add to that test's `testConfig({...})`:

```typescript
      upstreamRetries: 0,
```

The existing "fails over non-streaming requests and cools down the failing target" test (line ~547) asserts `calls` = `['project-a', 'project-b']` and `failure: 1`. Add `upstreamRetries: 0` to that config override too so it remains a pure failover test:

```typescript
      upstreamRetries: 0,
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/genai-pool.test.ts`
Expected: FAIL — no retry loop yet; `health.retries` is `undefined`.

- [ ] **Step 3: Extend `GenAiTargetHealth` with retry counters**

In `src/lib/genai-pool.ts`, add to `interface GenAiTargetHealth` after `failure: number;`:

```typescript
  retries: number;
  lastRetryAt?: string;
```

In `createSnapshotTarget`, initialize it in the `health` object after `failure: 0,`:

```typescript
    retries: 0,
```

- [ ] **Step 4: Add a retry-counter helper + constructor params**

Change the `GenAiPoolClient` constructor to accept retry policy:

```typescript
  constructor(
    private readonly getActiveSnapshot: () => GenAiPoolSnapshot,
    private readonly cooldownMs: number,
    private readonly upstreamRetries: number,
    private readonly upstreamRetryDelayMs: number,
  ) {}
```

Add a private helper method inside the class (after `pinSnapshot`):

```typescript
  private recordRetry(target: GenAiTarget): void {
    target.health.retries += 1;
    target.health.lastRetryAt = new Date().toISOString();
  }
```

Add the import at the top of the file:

```typescript
import { computeBackoffMs } from './retry.js';
```

- [ ] **Step 5: Wrap the non-stream execute in an inner retry loop**

Replace the body of `withFailover`'s `try` per-target block. The full method becomes:

```typescript
  private async withFailover(
    snapshot: GenAiPoolSnapshot,
    routeFamily: GenAiRouteFamily,
    requestId: string | undefined,
    requestedModel: string | null,
    execute: (target: GenAiTarget) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const attempted = new Set<string>();
    let lastError: unknown;

    while (attempted.size < snapshot.targets.length) {
      const target = this.selectAvailableTarget(snapshot, attempted, requestedModel, requestId);
      attempted.add(target.id);
      console.info(JSON.stringify({
        event: 'genai_pool.target_selected',
        ...(requestId ? { requestId } : {}),
        targetId: target.id,
        routeFamily,
        streaming: false,
      }));

      let attempt = 0;
      let targetError: unknown;
      // Inner per-target retries run before markFailure/cooldown/failover (spec §4).
      for (;;) {
        try {
          const response = await execute(target);
          markSuccess(target, routeFamily);
          return response;
        } catch (error) {
          const classification = classifyUpstreamError(error);
          targetError = error;
          if (classification.retryable && attempt < this.upstreamRetries) {
            this.recordRetry(target);
            const delay = computeBackoffMs(attempt, this.upstreamRetryDelayMs);
            attempt += 1;
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          markFailure(target, routeFamily, classification.code, this.cooldownMs, classification.shouldCooldown);
          lastError = withClassifiedGatewayError(error);
          if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
            throw lastError;
          }
          break;
        }
      }
      void targetError;
    }

    throw withClassifiedGatewayError(lastError ?? new Error('No GenAI targets are available.'));
  }
```

- [ ] **Step 6: Wrap the streaming first-chunk phase in an inner retry loop**

In the `generateContentStream` method, replace the per-target `try/catch` block (currently lines ~398-451) with a version that retries the first-chunk phase on the same target, cleaning up the iterator before each retry:

```typescript
          let iterator: AsyncIterator<Record<string, unknown>> | null = null;
          let attempt = 0;
          let handled = false;
          // Inner per-target retries around the first-chunk phase (spec §4). Each
          // failed attempt cleans up its iterator before retrying the same target.
          for (;;) {
            try {
              if (!target.client.models.generateContentStream) {
                throw new Error('Configured GenAI target does not support generateContentStream.');
              }
              const stream = await target.client.models.generateContentStream(request, metadata);
              iterator = stream[Symbol.asyncIterator]();
              const firstStep = await nextStreamStep(iterator, {
                idleTimeoutMs: metadata.streamGuard?.idleTimeoutMs ?? 30_000,
                maxDurationMs: metadata.streamGuard?.maxDurationMs ?? 240_000,
                startedAt: Date.now(),
              });
              if (firstStep.done) {
                markSuccess(target, routeFamily);
                snapshot.refCount -= 1;
                return {
                  async *[Symbol.asyncIterator]() {
                    // Upstream completed before yielding content.
                  },
                };
              }
              return wrapPinnedStream(
                iterator,
                firstStep,
                () => markSuccess(target, routeFamily),
                (error) => {
                  const classification = classifyUpstreamError(error);
                  markFailure(target, routeFamily, classification.code, this.cooldownMs, classification.shouldCooldown);
                },
                () => {
                  snapshot.refCount -= 1;
                },
              );
            } catch (error) {
              if (iterator && typeof iterator.return === 'function') {
                try {
                  await iterator.return();
                } catch {
                  // Ignore iterator cleanup after failed first step.
                }
              }
              iterator = null;
              const classification = classifyUpstreamError(error);
              if (classification.retryable && attempt < this.upstreamRetries) {
                this.recordRetry(target);
                const delay = computeBackoffMs(attempt, this.upstreamRetryDelayMs);
                attempt += 1;
                if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
              markFailure(target, routeFamily, classification.code, this.cooldownMs, classification.shouldCooldown);
              lastError = withClassifiedGatewayError(error);
              handled = true;
              if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
                throw lastError;
              }
              break;
            }
          }
          void handled;
```

- [ ] **Step 7: Pass retry config from the runtime**

In `src/lib/genai-runtime.ts`, update the `GenAiPoolClient` construction in the `GenAiRuntime` constructor:

```typescript
    this.client = new GenAiPoolClient(
      () => this.activeSnapshot,
      config.vertexPoolFailoverCooldownMs,
      config.upstreamRetries,
      config.upstreamRetryDelayMs,
    );
```

- [ ] **Step 8: Run the pool tests to verify they pass**

Run: `npm test -- test/genai-pool.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/genai-pool.ts src/lib/genai-runtime.ts test/genai-pool.test.ts
git commit -m "feat(pool): inner per-target retries with jitter before failover"
```

---

## Task 6: Surface retry config in readiness snapshot (§6)

**Files:**
- Modify: `src/routes/health-routes.ts`
- Test: `test/root-routes.test.ts`

- [ ] **Step 1: Write the failing test**

In `test/root-routes.test.ts`, inside the readyz test (the one that fetches `/readyz`, line ~178), add after the existing body assertions:

```typescript
    expect(body.limits.upstreamRetries).toBe(2);
    expect(body.limits.upstreamRetryDelayMs).toBe(250);
```

(If the readyz test does not already parse the JSON body into `body`, add `const body = await response.json();` after the fetch.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/root-routes.test.ts`
Expected: FAIL — `body.limits.upstreamRetries` is `undefined`.

- [ ] **Step 3: Add the fields to `readyResponse`**

In `src/routes/health-routes.ts`, inside the `limits` object of `readyResponse`, after `streamQueueLimit: config.streamQueueLimit,`, add:

```typescript
    upstreamRetries: config.upstreamRetries,
    upstreamRetryDelayMs: config.upstreamRetryDelayMs,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/root-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/health-routes.ts test/root-routes.test.ts
git commit -m "feat(health): expose resolved upstream retry policy in readyz"
```

---

## Task 7: probeTarget documentation + full verification

**Files:**
- Modify: `src/lib/genai-runtime.ts`
- Test: none new (documentation + full-suite gate)

- [ ] **Step 1: Document probeTarget retry semantics**

In `src/lib/genai-runtime.ts`, add a comment above `async probeTarget(...)`:

```typescript
  // probeTarget intentionally bypasses the pool's inner retry + failover logic.
  // It is a lightweight single-attempt health check against one target; callers
  // must not rely on it for retry behavior. See spec §6.
```

- [ ] **Step 2: Run the compile step**

Run: `npm run compile`
Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS. Any remaining failures are hard-coded call counts or error bodies in tests not yet touched — update them to match the new `1 + upstreamRetries` attempt model and route-family error shapes, then re-run.

- [ ] **Step 4: Commit**

```bash
git add src/lib/genai-runtime.ts
git commit -m "docs(runtime): note probeTarget bypasses pool retry semantics"
```

---

## Self-Review

**Spec coverage:**
- §1 Config surface → Task 1 (env fields, defaults, precedence env>overlay>file>default, 0-allowed validation, snapshot in Task 6).
- §2 Classification single source → Task 2 (`getErrorStatus`, status-first `classifyUpstreamError`, `isTransientError` delegates, `gatewayErrorFromStatus`).
- §3 Error contract → Task 3 (gateway vs openai envelopes for JSON + SSE, family threading through app.ts/dispatch/sse, first-frame contract preserved because pre-header errors still throw in `driveSseStream`).
- §4 Jittered retries & failover → Task 5 (non-stream + streaming inner retry loops, iterator cleanup per retry, markSuccess/markFailure timing, counters).
- §5 Backoff → Task 4 (exponential + full jitter, base 250, configurable, commented referencing spec).
- §6 Observability/health → Task 5 (retry counters on health) + Task 6 (readyz limits) + Task 7 (probeTarget doc).

**Placeholder scan:** No TBD/TODO. Every code step shows full code. Test bodies are concrete.

**Type consistency:** `ErrorFormat` used consistently across `error-response.ts`, `sse-response.ts`, `route-dispatch.ts`, `app.ts`. `health.retries` written in `recordRetry` and asserted in tests. `computeBackoffMs(attempt, baseDelayMs)` signature matches all call sites (retry.ts, genai-pool.ts). `GenAiPoolClient` 4-arg constructor matches `genai-runtime.ts` construction. `formatOpenAiErrorBody` uses `code: 'internal_error'` for JSON; SSE path uses inline `code: null` per spec's JSON-vs-SSE distinction.

**Note on iterator cleanup test (Task 5 Step 1 streaming test):** asserts `return` is called once per failed first-chunk attempt via the `return:project-a:N` markers, satisfying the spec's "iterator.return() called once per failed attempt" requirement.
