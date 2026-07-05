# Full Vertex API-Key Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make API-key pool targets use the full Vertex / Agent Platform resource path by default while preserving explicit express mode and existing service-account behavior.

**Architecture:** Add `apiKeyMode: "full" | "express"` to resolved target config, normalize legacy configs during load, and keep pool/route code behind the existing `GenAiClient` boundary. Implement a small REST `GenAiClient` for full API-key targets that moves `model` into the Vertex URL path and sends the remaining SDK-like request as JSON. Keep the Google GenAI SDK for express API-key targets and service-account/ADC targets.

**Tech Stack:** TypeScript ESM, Node >=22 global `fetch`, `@google/genai`, raw `node:http`, Vitest 4.

---

## File Structure

**Config surface**
- Modify `src/config/env.ts`: add `VertexApiKeyMode`, extend `VertexPoolConfig`, normalize pool/env/legacy targets, validate invalid modes and full-mode requirements.
- Modify `test/test-config.ts`: include `apiKeyMode` in the default resolved target fixture.
- Test in `test/env-config.test.ts`: omitted/explicit/invalid `apiKeyMode`, `VERTEX_POOLS` default, legacy single-mode default.

**Full Vertex REST client**
- Create `src/lib/vertex-rest-client.ts`: implements `GenAiClient` with non-streaming and SSE streaming support using Node `fetch`.
- Test in `test/vertex-rest-client.test.ts`: endpoint selection, header auth, body mapping, non-2xx errors, streaming parser.

**Factory selector**
- Modify `src/lib/google-genai-client.ts`: choose REST client for `apiKey + apiKeyMode === "full"`, SDK express path for `apiKey + apiKeyMode === "express"`, SDK project/location path for service-account/ADC.
- Test in `test/google-genai-client.test.ts`: full mode avoids SDK and returns REST behavior, express mode keeps SDK apiKey-only, service-account behavior remains.

**Docs/config examples**
- Modify `AGENTS.md`: update the API-key upstream credential section so it no longer says all API-key targets are express mode.
- Modify `pool-config.example.json` only if it contains `apiKey` examples; add `apiKeyMode` to those examples without adding real secrets.

---

## Task 1: Add config type, normalization, and validation

**Files:**
- Modify: `src/config/env.ts`
- Modify: `test/test-config.ts`
- Test: `test/env-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add these tests near the existing vertex pool overlay tests in `test/env-config.test.ts`:

```typescript
  it('defaults api-key pool targets with project and location to full mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          apiKey: 'AIza-test-key',
          enabled: true,
          weight: 1,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();

    expect(config.vertexPools[0]).toEqual(expect.objectContaining({
      id: 'project-a',
      apiKeyMode: 'full',
    }));
    expect(config.resolvedVertexTargets[0]).toEqual(expect.objectContaining({
      id: 'project-a',
      apiKeyMode: 'full',
      source: 'pool',
    }));
  });

  it('preserves explicit express mode for api-key pool targets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          apiKey: 'AIza-test-key',
          apiKeyMode: 'express',
          enabled: true,
          weight: 1,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();

    expect(config.resolvedVertexTargets[0]).toEqual(expect.objectContaining({
      id: 'project-a',
      apiKeyMode: 'express',
    }));
  });

  it('rejects invalid apiKeyMode values in pool targets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          apiKey: 'AIza-test-key',
          apiKeyMode: 'legacy',
          enabled: true,
          weight: 1,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/apiKeyMode.*full.*express/);
  });

  it('defaults VERTEX_POOLS entries to full api-key mode', () => {
    process.env.GATEWAY_API_KEYS = 'gateway-key';
    process.env.VERTEX_POOLS = 'project-a:global:AIza-test-key';
    delete process.env.GATEWAY_CONFIG_FILE;
    delete process.env.GATEWAY_POOL_CONFIG_FILE;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();

    expect(config.vertexPools[0]).toEqual(expect.objectContaining({
      id: 'env-project-a',
      apiKeyMode: 'full',
    }));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --runInBand test/env-config.test.ts
```

Expected: FAIL because `apiKeyMode` is not present and invalid values are not validated.

- [ ] **Step 3: Implement config type and normalization**

In `src/config/env.ts`, update the top-level types:

```typescript
export type VertexPoolSelection = "round-robin" | "weighted-round-robin";
export type VertexApiKeyMode = "full" | "express";
export type AdminStoreMode = "static-config" | "file-store";
export type GatewayRuntimeMode = "single" | "pool";

export interface VertexPoolConfig {
  id: string;
  label?: string;
  project: string;
  location: string;
  credentialsFile: string | null;
  apiKey: string | null;
  apiKeyMode: VertexApiKeyMode;
  enabled: boolean;
  weight: number;
  modelAllowlist: string[];
  modelExclusions: string[];
}
```

Add these helpers near the other normalization helpers:

```typescript
const normalizeApiKeyMode = (
  value: unknown,
  apiKey: string | null,
  project: string,
  location: string,
  targetId: string,
): VertexApiKeyMode => {
  if (value === undefined || value === null || value === '') {
    return apiKey && project.trim() && location.trim() ? 'full' : 'express';
  }
  if (value === 'full' || value === 'express') return value;
  throw new Error(
    `Vertex pool ${targetId} apiKeyMode must be "full" or "express".`,
  );
};

const normalizeVertexPoolConfig = (entry: VertexPoolConfig): VertexPoolConfig => {
  const apiKey = entry.apiKey ?? null;
  const credentialsFile = entry.credentialsFile ?? null;
  const project = entry.project ?? '';
  const location = entry.location ?? '';
  const targetId = entry.id || '(unknown)';
  return {
    ...entry,
    project,
    location,
    credentialsFile,
    apiKey,
    apiKeyMode: normalizeApiKeyMode(
      (entry as VertexPoolConfig & { apiKeyMode?: unknown }).apiKeyMode,
      apiKey,
      project,
      location,
      targetId,
    ),
    modelAllowlist: entry.modelAllowlist ?? [],
    modelExclusions: entry.modelExclusions ?? [],
  };
};
```

Update `parseVertexPoolsEnv()` return objects to include full mode:

```typescript
      return {
        id: `env-${project}`,
        label: `${project} (env)`,
        project,
        location,
        credentialsFile: null,
        apiKey,
        apiKeyMode: 'full',
        enabled: true,
        weight: 1,
        modelAllowlist: [],
        modelExclusions: [],
      };
```

When building `vertexPools` in `loadConfig()`, normalize both env and overlay values. Use the local shape already present in the file, but make sure the final field is:

```typescript
  const vertexPools = (envVertexPools.length > 0
    ? envVertexPools
    : (poolOverlay.vertexPools ?? [])
  ).map(normalizeVertexPoolConfig);
```

Update `resolveVertexTargets()` legacy target to include normalized mode:

```typescript
      apiKey: config.googleApiKey,
      apiKeyMode: normalizeApiKeyMode(
        undefined,
        config.googleApiKey,
        config.googleProject,
        config.googleLocation,
        'legacy-default',
      ),
      enabled: true,
```

Update `createDerivedConfig()` so overridden pools are normalized immutably:

```typescript
    ...(overrides.vertexPools
      ? { vertexPools: overrides.vertexPools.map((entry) => normalizeVertexPoolConfig({ ...entry })) }
      : {}),
```

- [ ] **Step 4: Implement validation**

In `validateConfig()` inside the `config.vertexPools.length > 0` loop, after the existing project/location check and before credential loading, add:

```typescript
      if (entry.apiKeyMode !== 'full' && entry.apiKeyMode !== 'express') {
        throw new Error(
          `Vertex pool ${entry.id} apiKeyMode must be "full" or "express".`,
        );
      }
      if (entry.apiKey && entry.apiKeyMode === 'full' && (!entry.project.trim() || !entry.location.trim())) {
        throw new Error(
          `Vertex pool ${entry.id} uses apiKeyMode "full" and must include non-empty project and location.`,
        );
      }
```

Keep the existing rule that pool entries require non-empty `project` and `location`; this repository already treats pool target identity as project/location-based.

- [ ] **Step 5: Update test fixtures**

In `test/test-config.ts`, add `apiKeyMode: 'full'` to the default `resolvedVertexTargets[0]` object:

```typescript
    apiKey: null,
    apiKeyMode: 'full',
    enabled: true,
```

- [ ] **Step 6: Run config tests**

Run:

```bash
npm test -- test/env-config.test.ts test/google-genai-client.test.ts
```

Expected: env config tests PASS; google client tests may still fail until Task 3 updates fixtures.

- [ ] **Step 7: Commit config changes**

```bash
git add src/config/env.ts test/env-config.test.ts test/test-config.ts
git commit -m "feat: add vertex api key mode config"
```

---

## Task 2: Add the full Vertex REST GenAiClient

**Files:**
- Create: `src/lib/vertex-rest-client.ts`
- Test: `test/vertex-rest-client.test.ts`

- [ ] **Step 1: Write failing REST client tests**

Create `test/vertex-rest-client.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../src/http/error-response.js';
import { createVertexRestClient } from '../src/lib/vertex-rest-client.js';

const jsonResponse = (status: number, body: unknown): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

describe('Vertex REST client', () => {
  it('builds the global full Vertex endpoint and removes model from the body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-test-key',
      project: 'project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1234,
      fetchFn: fetchMock,
    });

    await client.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'draw' }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://aiplatform.googleapis.com/v1/projects/project-a/locations/global/publishers/google/models/gemini-2.5-flash-image:generateContent');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(expect.objectContaining({
      'content-type': 'application/json',
      'x-goog-api-key': 'AIza-test-key',
    }));
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'draw' }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });
  });

  it('builds regional full Vertex endpoints', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-test-key',
      project: 'project-a',
      location: 'us-central1',
      apiVersion: 'v1',
      timeoutMs: 1000,
      fetchFn: fetchMock,
    });

    await client.models.generateContent({ model: 'gemini-3.5-flash', contents: 'hello' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us-central1-aiplatform.googleapis.com/v1/projects/project-a/locations/us-central1/publishers/google/models/gemini-3.5-flash:generateContent');
  });

  it('throws validation error when model is missing', async () => {
    const client = createVertexRestClient({
      apiKey: 'AIza-test-key',
      project: 'project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1000,
      fetchFn: vi.fn(),
    });

    await expect(client.models.generateContent({ contents: 'hello' }))
      .rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('throws a GatewayError with upstream status for non-2xx responses', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, {
      error: { message: 'Model not found in projects/project-a/locations/global' },
    }));
    const client = createVertexRestClient({
      apiKey: 'AIza-test-key',
      project: 'project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1000,
      fetchFn: fetchMock,
    });

    await expect(client.models.generateContent({ model: 'missing-model', contents: 'hello' }))
      .rejects.toBeInstanceOf(GatewayError);
    await expect(client.models.generateContent({ model: 'missing-model', contents: 'hello' }))
      .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('parses streamGenerateContent SSE data events', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(': keepalive\n\n'));
        controller.enqueue(encoder.encode('data: {"candidates":[{"index":0}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"candidates":[{"index":1}]}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, { status: 200 }));
    const client = createVertexRestClient({
      apiKey: 'AIza-test-key',
      project: 'project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1000,
      fetchFn: fetchMock,
    });

    const iterable = await client.models.generateContentStream?.({
      model: 'gemini-3.5-flash',
      contents: 'hello',
    });

    const chunks = [];
    for await (const chunk of iterable ?? []) chunks.push(chunk);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://aiplatform.googleapis.com/v1/projects/project-a/locations/global/publishers/google/models/gemini-3.5-flash:streamGenerateContent?alt=sse');
    expect(chunks).toEqual([
      { candidates: [{ index: 0 }] },
      { candidates: [{ index: 1 }] },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/vertex-rest-client.test.ts
```

Expected: FAIL because `src/lib/vertex-rest-client.ts` does not exist.

- [ ] **Step 3: Implement the REST client**

Create `src/lib/vertex-rest-client.ts`:

```typescript
import { GatewayError, gatewayErrorFromStatus, safeErrorMessage } from '../http/error-response.js';
import type { GenAiClient } from './google-genai-client.js';
import type { GenAiRequestMetadata } from './genai-request-metadata.js';

export interface VertexRestClientOptions {
  apiKey: string;
  project: string;
  location: string;
  apiVersion: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

const encodePathSegment = (value: string): string => encodeURIComponent(value);

const endpointHost = (location: string): string => (
  location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`
);

const buildModelUrl = (
  options: Pick<VertexRestClientOptions, 'project' | 'location' | 'apiVersion'>,
  model: string,
  method: 'generateContent' | 'streamGenerateContent',
): string => {
  const base = endpointHost(options.location);
  const resource = [
    options.apiVersion,
    'projects',
    encodePathSegment(options.project),
    'locations',
    encodePathSegment(options.location),
    'publishers',
    'google',
    'models',
    `${encodePathSegment(model)}:${method}`,
  ].join('/');
  return method === 'streamGenerateContent'
    ? `${base}/${resource}?alt=sse`
    : `${base}/${resource}`;
};

const splitModelFromRequest = (
  request: Record<string, unknown>,
): { model: string; body: Record<string, unknown> } => {
  const model = typeof request.model === 'string' ? request.model.trim() : '';
  if (!model) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Vertex REST request requires a non-empty model.', false);
  }
  const { model: _model, ...body } = request;
  return { model, body };
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const parsed = await response.clone().json() as unknown;
    if (parsed && typeof parsed === 'object') {
      const error = (parsed as Record<string, unknown>).error;
      if (error && typeof error === 'object') {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
      const message = (parsed as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  } catch {
    // Fall back to text/status below.
  }
  try {
    const text = await response.text();
    if (text.trim()) return text;
  } catch {
    // Fall back to status text below.
  }
  return response.statusText || `Upstream request failed with HTTP ${response.status}.`;
};

const throwForResponse = async (response: Response): Promise<void> => {
  if (response.ok) return;
  const message = await extractErrorMessage(response);
  const gatewayError = gatewayErrorFromStatus(response.status, message);
  throw gatewayError ?? new GatewayError(response.status, 'UPSTREAM_UNAVAILABLE', message, response.status >= 500);
};

const composeSignal = (
  timeoutMs: number,
  signal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    },
  };
};

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const drainEvent = async function* (event: string): AsyncIterable<Record<string, unknown>> {
    const dataLines = event
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;
    yield JSON.parse(data) as Record<string, unknown>;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const event of events) {
        yield* drainEvent(event);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* drainEvent(buffer);
  } finally {
    reader.releaseLock();
  }
}

export const createVertexRestClient = (options: VertexRestClientOptions): GenAiClient => {
  const fetchFn = options.fetchFn ?? fetch;
  const headers = {
    'content-type': 'application/json',
    'x-goog-api-key': options.apiKey,
  };

  return {
    models: {
      generateContent: async (
        request: Record<string, unknown>,
        metadata: GenAiRequestMetadata = {},
      ): Promise<Record<string, unknown>> => {
        const { model, body } = splitModelFromRequest(request);
        const { signal, cleanup } = composeSignal(options.timeoutMs, metadata.signal);
        try {
          const response = await fetchFn(buildModelUrl(options, model, 'generateContent'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
          });
          await throwForResponse(response);
          return await response.json() as Record<string, unknown>;
        } catch (error: unknown) {
          if (error instanceof GatewayError) throw error;
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new GatewayError(504, 'TIMEOUT', 'Upstream Vertex request timed out.', true);
          }
          throw new GatewayError(502, 'UPSTREAM_UNAVAILABLE', safeErrorMessage(error), true);
        } finally {
          cleanup();
        }
      },
      generateContentStream: async (
        request: Record<string, unknown>,
        metadata: GenAiRequestMetadata = {},
      ): Promise<AsyncIterable<Record<string, unknown>>> => {
        const { model, body } = splitModelFromRequest(request);
        const { signal, cleanup } = composeSignal(options.timeoutMs, metadata.signal);
        try {
          const response = await fetchFn(buildModelUrl(options, model, 'streamGenerateContent'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
          });
          await throwForResponse(response);
          if (!response.body) {
            throw new GatewayError(502, 'UPSTREAM_UNAVAILABLE', 'Upstream Vertex stream did not include a response body.', true);
          }
          const bodyStream = response.body;
          return {
            async *[Symbol.asyncIterator]() {
              try {
                yield* parseSseStream(bodyStream);
              } finally {
                cleanup();
              }
            },
          };
        } catch (error: unknown) {
          cleanup();
          if (error instanceof GatewayError) throw error;
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw new GatewayError(504, 'TIMEOUT', 'Upstream Vertex request timed out.', true);
          }
          throw new GatewayError(502, 'UPSTREAM_UNAVAILABLE', safeErrorMessage(error), true);
        }
      },
    },
  };
};
```

If TypeScript reports `gatewayErrorFromStatus` is not exported, export it from `src/http/error-response.ts` without changing its implementation.

- [ ] **Step 4: Run REST client tests**

Run:

```bash
npm test -- test/vertex-rest-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit REST client**

```bash
git add src/lib/vertex-rest-client.ts test/vertex-rest-client.test.ts src/http/error-response.ts
git commit -m "feat: add full vertex rest client"
```

---

## Task 3: Select REST vs SDK in the target client factory

**Files:**
- Modify: `src/lib/google-genai-client.ts`
- Test: `test/google-genai-client.test.ts`

- [ ] **Step 1: Update failing factory tests**

In `test/google-genai-client.test.ts`, add a mock for the REST client before the `@google/genai` mock:

```typescript
const { googleGenAiMock, createVertexRestClientMock } = vi.hoisted(() => ({
  googleGenAiMock: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: vi.fn() } };
  }),
  createVertexRestClientMock: vi.fn(() => ({
    models: { generateContent: vi.fn(), generateContentStream: vi.fn() },
  })),
}));

vi.mock('../src/lib/vertex-rest-client.js', () => ({
  createVertexRestClient: createVertexRestClientMock,
}));
```

Add `beforeEach` to clear mocks:

```typescript
beforeEach(() => {
  googleGenAiMock.mockClear();
  createVertexRestClientMock.mockClear();
});
```

Update existing target fixtures to include `apiKeyMode: 'full'` or `'express'`.

Add this test:

```typescript
  it('uses the REST client for full api-key targets', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig({ googleApiVersion: 'v1', upstreamTimeoutMs: 45678 }),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: 'AIzafull-mode-test-key',
        apiKeyMode: 'full',
        enabled: true,
        weight: 2,
        label: 'Project A',
        modelAllowlist: [],
        modelExclusions: [],
        source: 'pool',
      },
    );

    expect(createVertexRestClientMock).toHaveBeenCalledWith({
      apiKey: 'AIzafull-mode-test-key',
      project: 'pool-project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 45678,
    });
    expect(googleGenAiMock).not.toHaveBeenCalled();
  });
```

Update the express test target with:

```typescript
apiKeyMode: 'express',
```

and assert REST is not used:

```typescript
expect(createVertexRestClientMock).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/google-genai-client.test.ts
```

Expected: FAIL because factory still sends all API-key targets through SDK express mode.

- [ ] **Step 3: Implement factory selection**

In `src/lib/google-genai-client.ts`, import the REST client:

```typescript
import { createVertexRestClient } from './vertex-rest-client.js';
```

Update the API-key branch in `createGoogleGenAiClientForTarget`:

```typescript
  if (apiKey && target.apiKeyMode === 'full') {
    return createVertexRestClient({
      apiKey,
      project: target.project,
      location: target.location,
      apiVersion: config.googleApiVersion,
      timeoutMs: config.upstreamTimeoutMs,
    });
  }
```

Then keep the existing SDK options path, but make the API-key branch explicitly express:

```typescript
  if (apiKey) {
    // Express mode: API key auth, no service account.
    // SDK rejects/ignores API-key auth when project+location are present,
    // so we intentionally omit them here.
    options.apiKey = apiKey;
  } else {
```

The full function should still return `new GoogleGenAI(options)` for express and service-account/ADC targets.

- [ ] **Step 4: Run factory tests**

Run:

```bash
npm test -- test/google-genai-client.test.ts test/vertex-rest-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit factory selection**

```bash
git add src/lib/google-genai-client.ts test/google-genai-client.test.ts
git commit -m "feat: select full vertex api key client"
```

---

## Task 4: Update docs and config examples

**Files:**
- Modify: `AGENTS.md`
- Optional modify: `pool-config.example.json` if it contains API-key pool examples
- Optional modify: `README.md` if it documents `apiKey` target behavior

- [ ] **Step 1: Search docs for stale express-only wording**

Run:

```bash
git grep -n "express mode\|apiKeyMode\|SDK discards\|apiKey" -- AGENTS.md README.md docs pool-config.example.json config.yaml
```

Expected: identify any docs saying API-key targets are always express mode.

- [ ] **Step 2: Update `AGENTS.md` auth concept text**

Replace the current API-key section with wording equivalent to:

```markdown
**Kiểu B — Google Cloud API Key** (`apiKey`): có hai chế độ per target:

- `apiKeyMode: "full"` (mặc định khi target có `apiKey` + `project` + `location`): gateway gọi full Vertex / Agent Platform path với `/projects/{project}/locations/{location}/...` và gửi key qua `x-goog-api-key`.
- `apiKeyMode: "express"`: gateway giữ đường SDK API-key-only, không truyền `project`/`location`, dùng cho express mode.

> ⚠️ **Priority**: `apiKey` thắng `credentialsFile` nếu cả hai present.
```

Keep the Vietnamese warning about not confusing gateway key and upstream key.

- [ ] **Step 3: Update API-key example configs if present**

If `pool-config.example.json` has API-key targets, add:

```json
"apiKeyMode": "full"
```

Do not add real keys. Do not modify `pool-config.local.json`, `.env`, or files under `accounts/`.

- [ ] **Step 4: Commit docs**

```bash
git add AGENTS.md README.md pool-config.example.json
git commit -m "docs: document vertex api key modes"
```

If only `AGENTS.md` changed, use:

```bash
git add AGENTS.md
git commit -m "docs: document vertex api key modes"
```

---

## Task 5: Full validation and security review

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript compile**

Run:

```bash
npm run compile
```

Expected: PASS.

- [ ] **Step 3: Inspect diff for secrets and unintended files**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
git diff --cached --stat
```

Expected: no `accounts/*.json`, `.env`, `pool-config.local.json`, or real API keys are present.

- [ ] **Step 4: Optional local Docker validation**

Only run this if the operator has local non-secret config already prepared and wants live verification:

```bash
docker compose up -d --build
```

Then verify these through the gateway without printing upstream keys:

- `/readyz` reports healthy pool targets.
- `gemini-2.5-flash-image` image generation returns 200 for full-mode global targets.
- Gemini 3 image generation still returns 200.
- Text chat with `gemini-3.5-flash` still returns 200.

- [ ] **Step 5: Run code review agents**

Use `code-reviewer-pro` on the final diff. Because this change handles upstream API-key authentication and external API calls, also use `security-reviewer`. Fix CRITICAL/HIGH findings before continuing.

- [ ] **Step 6: Final commit if review fixes were applied**

If review fixes changed code, run tests again and commit:

```bash
npm test
npm run compile
git add src test AGENTS.md README.md pool-config.example.json
git commit -m "fix: address vertex api key mode review"
```

---

## Self-Review Checklist

- Spec coverage: config mode, REST full endpoint, express preservation, service-account preservation, streaming, errors, no API-key logging, route/pool compatibility, and docs are covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `VertexApiKeyMode`, `apiKeyMode`, `createVertexRestClient`, `VertexRestClientOptions`, and `GenAiClient` names are consistent across tasks.
- Security: plan explicitly avoids committing `.env`, `accounts/*.json`, `pool-config.local.json`, and never prints upstream API keys.
