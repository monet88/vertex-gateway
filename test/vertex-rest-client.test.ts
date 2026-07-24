import { describe, expect, it, vi } from 'vitest';
import { GatewayError } from '../src/http/error-response.js';
import { createVertexRestClient } from '../src/lib/vertex-rest-client.js';

const createJsonResponse = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const createSseResponse = (events: string[]): Response => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    },
  );
};

describe('vertex REST client', () => {
  it('calls the global endpoint and omits model from the JSON body', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-2.5-flash:generateContent',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    });
  });

  it('overrides location to asia-southeast1 when model is chirp-3, chirp-3-hd, or chirp-3-instant-custom-voice', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({
      model: 'chirp-3-hd',
      contents: [{ role: 'user', parts: [{ text: 'speech' }] }],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://asia-southeast1-aiplatform.googleapis.com/v1/projects/test-project/locations/asia-southeast1/publishers/google/models/chirp-3-hd:generateContent',
    );
  });

  it('overrides location to us-central1 when model is veo-3.1-generate-001', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({
      model: 'veo-3.1-generate-001',
      contents: [{ role: 'user', parts: [{ text: 'generate video' }] }],
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/veo-3.1-generate-001:generateContent',
    );
  });

  it('translates SDK config into the Vertex REST request shape', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      config: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 64,
        responseModalities: ['TEXT'],
        imageConfig: { aspectRatio: '1:1' },
        systemInstruction: { parts: [{ text: 'be terse' }] },
        tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }],
      },
    });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 64,
        responseModalities: ['TEXT'],
        imageConfig: { aspectRatio: '1:1' },
      },
      systemInstruction: { parts: [{ text: 'be terse' }] },
      tools: [{ functionDeclarations: [{ name: 'lookup' }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }],
    });
  });

  it('warns when SDK config contains fields unsupported by the REST translation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
      const client = createVertexRestClient({
        apiKey: 'AIza-fake-test-key',
        project: 'test-project',
        location: 'global',
        apiVersion: 'v1',
        timeoutMs: 1_000,
        fetchFn,
      });

      await client.models.generateContent({
        model: 'gemini-2.5-flash',
        config: { unsupportedFutureField: true },
      });

      expect(warnSpy).toHaveBeenCalledWith(JSON.stringify({
        event: 'vertex_rest_client.unsupported_config_keys',
        keys: ['unsupportedFutureField'],
      }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('calls the regional endpoint for non-global locations', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'us-central1',
      apiVersion: 'v1beta1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [],
    });

    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/test-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    );
  });

  it('sends the x-goog-api-key and JSON content-type headers', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await client.models.generateContent({ model: 'gemini-2.5-flash' });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('x-goog-api-key')).toBe('AIza-fake-test-key');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('rejects requests without a non-empty model string', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContent({ contents: [] })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('preserves upstream 404 messages while mapping status and code', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ error: { message: 'missing model in publisher catalog' } }, 404));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'missing model in publisher catalog',
    });
    await expect(client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toBeInstanceOf(GatewayError);
  });

  it('preserves upstream 400 messages while mapping status and code', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ error: { message: 'temperature must be between 0 and 2' } }, 400));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'temperature must be between 0 and 2',
    });
  });

  it('parses multiple SSE data events and ignores comments or keepalives', async () => {
    const fetchFn = vi.fn(async () => createSseResponse([
      ': keepalive\n\n',
      'data: {"chunk":1}\n\n',
      ': still-alive\n',
      '\n',
      'data: {"chunk":2}\n\n',
    ]));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    const stream = await client.models.generateContentStream?.({ model: 'gemini-2.5-flash' });
    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of stream ?? []) {
      chunks.push(chunk);
    }

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    expect(chunks).toEqual([{ chunk: 1 }, { chunk: 2 }]);
  });

  it('passes the caller abort signal into REST requests', async () => {
    const fetchFn = vi.fn(async () => createJsonResponse({ candidates: [] }));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });
    const abortController = new AbortController();

    await client.models.generateContent(
      { model: 'gemini-2.5-flash' },
      { signal: abortController.signal },
    );

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
    expect((init.signal as AbortSignal).aborted).toBe(false);
    abortController.abort();
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });

  it('cancels the SSE reader when iteration stops early', async () => {
    const cancelSpy = vi.fn(async () => undefined);
    const releaseLockSpy = vi.fn(() => undefined);
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"chunk":1}\n\n') })
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"chunk":2}\n\n') }),
      cancel: cancelSpy,
      releaseLock: releaseLockSpy,
    };
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => reader,
      },
    } as unknown as Response));
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    const stream = await client.models.generateContentStream?.({ model: 'gemini-2.5-flash' });
    const iterator = stream?.[Symbol.asyncIterator]();
    const first = await iterator?.next();
    expect(first?.value).toEqual({ chunk: 1 });
    await iterator?.return?.(undefined);

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(releaseLockSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the request timeout after streaming response headers arrive', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => createSseResponse(['data: {"chunk":1}\n\n']));
      const client = createVertexRestClient({
        apiKey: 'AIza-fake-test-key',
        project: 'test-project',
        location: 'global',
        apiVersion: 'v1',
        timeoutMs: 1_000,
        fetchFn,
      });

      await client.models.generateContentStream?.({ model: 'gemini-2.5-flash' });
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      vi.advanceTimersByTime(1_001);

      expect((init.signal as AbortSignal).aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies timeouts correctly even if the caller aborts after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const abortController = new AbortController();
      const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          abortController.abort();
          reject(new DOMException('Upstream request timed out.', 'AbortError'));
        }, { once: true });
      }));
      const client = createVertexRestClient({
        apiKey: 'AIza-fake-test-key',
        project: 'test-project',
        location: 'global',
        apiVersion: 'v1',
        timeoutMs: 1_000,
        fetchFn,
      });

      const promise = client.models.generateContent(
        { model: 'gemini-2.5-flash' },
        { signal: abortController.signal },
      );
      vi.advanceTimersByTime(1_001);

      await expect(promise).rejects.toMatchObject({ status: 504, code: 'TIMEOUT' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('classifies fetch network failures as upstream unavailable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      retryable: true,
    });
  });

  it('preserves non-DOM abort errors from fetch implementations', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const fetchFn = vi.fn(async () => {
      throw abortError;
    });
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toBe(abortError);
  });

  it('classifies streaming fetch network failures as upstream unavailable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createVertexRestClient({
      apiKey: 'AIza-fake-test-key',
      project: 'test-project',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 1_000,
      fetchFn,
    });

    await expect(client.models.generateContentStream?.({ model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      retryable: true,
    });
  });
});
