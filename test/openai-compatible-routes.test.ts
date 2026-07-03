import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createOpenAiTestClient } from './openai-test-client.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

describe('openai-compatible routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    vi.restoreAllMocks();
  });

  it('returns OpenAI-compatible chat completions from Gemini responses', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{
        content: {
          parts: [{ text: 'ok' }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 7,
        totalTokenCount: 18,
      },
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        messages: [
          { role: 'system', content: 'You are concise.' },
          { role: 'user', content: 'Reply with exactly ok' },
        ],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message).toMatchObject({ role: 'assistant', content: 'ok' });
    expect(body.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Reply with exactly ok' }] }],
      config: {
        systemInstruction: { parts: [{ text: 'You are concise.' }] },
      },
    }), expect.objectContaining({ routeFamily: 'openai-chat' }));
  });

  it('returns one OpenAI choice for each requested Gemini candidate', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [
        {
          content: { parts: [{ text: 'first' }] },
          finishReason: 'STOP',
        },
        {
          content: { parts: [{ text: 'second' }] },
          finishReason: 'MAX_TOKENS',
        },
      ],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 9,
        totalTokenCount: 14,
      },
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        n: 2,
        messages: [{ role: 'user', content: 'Give two options' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.choices).toHaveLength(2);
    expect(body.choices[0]).toMatchObject({
      index: 0,
      message: { role: 'assistant', content: 'first' },
      finish_reason: 'stop',
    });
    expect(body.choices[1]).toMatchObject({
      index: 1,
      message: { role: 'assistant', content: 'second' },
      finish_reason: 'length',
    });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Give two options' }] }],
      config: { candidateCount: 2 },
    }), expect.objectContaining({ routeFamily: 'openai-chat' }));
  });

  it('maps OpenAI generation options into Gemini config', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 64,
        stop: ['END'],
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      config: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 64,
        stopSequences: ['END'],
      },
    }), expect.objectContaining({ routeFamily: 'openai-chat' }));
  });

  it('maps OpenAI tools into Gemini config tools', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        temperature: 0.1,
        messages: [{ role: 'user', content: 'call a tool' }],
        tools: [{
          type: 'function',
          function: {
            name: 'lookup',
            description: 'Lookup data',
            parameters: { type: 'object', properties: { id: { type: 'string' } } },
          },
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'call a tool' }] }],
      config: {
        temperature: 0.1,
        tools: [{
          functionDeclarations: [{
            name: 'lookup',
            description: 'Lookup data',
            parameters: { type: 'object', properties: { id: { type: 'string' } } },
          }],
        }],
      },
    }), expect.objectContaining({ routeFamily: 'openai-chat' }));
  });

  it('accepts image_url data URLs with embedded base64 whitespace', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{
        content: {
          parts: [{ text: 'ok' }],
        },
        finishReason: 'STOP',
      }],
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        messages: [{
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YW Jj\nZA==' } }],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('lists OpenAI-compatible models behind the /openai prefix', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/models`, {
      headers: { authorization: 'Bearer test-key' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe('list');
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gemini-3.5-flash', object: 'model' }),
    ]));
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('streams OpenAI-compatible chat completion chunks followed by [DONE]', async () => {
    async function* streamChunks() {
      yield { candidates: [{ content: { parts: [{ text: 'hel' }] } }], modelVersion: 'gemini-3.5-flash' };
      yield { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash' };
    }

    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(body).toContain('"delta":{"role":"assistant","content":"hel"}');
    expect(body).toContain('"delta":{"content":"lo"},"finish_reason":"stop"');
    expect(body).toContain('data: [DONE]');
    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    }), expect.objectContaining({
      routeFamily: 'openai-chat',
      streamGuard: {
        idleTimeoutMs: 250,
        maxDurationMs: 10000,
      },
    }));
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('is consumable by the OpenAI SDK against the local chat completions route', async () => {
    async function* streamChunks() {
      yield { candidates: [{ content: { parts: [{ text: 'hel' }] } }], modelVersion: 'gemini-3.5-flash' };
      yield { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash' };
    }

    const generateContentStream = vi.fn(async () => streamChunks());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream } }) });
    const baseUrl = await listen(server);
    const client = createOpenAiTestClient(`${baseUrl}/openai/v1`);

    const stream = await client.chat.completions.create({
      model: 'gemini-3.5-flash',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    });

    const deltas: string[] = [];
    for await (const event of stream) {
      const content = event.choices[0]?.delta?.content;
      if (content) deltas.push(content);
    }

    expect(deltas.join('')).toBe('hello');
  });

  it('emits the first OpenAI SSE chunk before the upstream generator completes', async () => {
    let releaseCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    async function* delayedStream() {
      yield { candidates: [{ content: { parts: [{ text: 'first' }] } }], modelVersion: 'gemini-3.5-flash' };
      await completionGate;
      yield { candidates: [{ content: { parts: [{ text: 'second' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash' };
    }

    const generateContentStream = vi.fn(async () => delayedStream());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain('"delta":{"role":"assistant","content":"first"}');

    let completed = false;
    const remainderPromise = (async () => {
      let body = '';
      while (true) {
        const next = await reader!.read();
        if (next.done) break;
        body += new TextDecoder().decode(next.value);
      }
      completed = true;
      return body;
    })();

    expect(completed).toBe(false);
    releaseCompletion();
    const remainder = await remainderPromise;

    expect(remainder).toContain('"delta":{"content":"second"},"finish_reason":"stop"');
    expect(remainder).toContain('data: [DONE]');
  });

  it('keeps post-header upstream errors inside SSE frames and never appends JSON', async () => {
    async function* brokenStream() {
      yield { candidates: [{ content: { parts: [{ text: 'partial' }] } }], modelVersion: 'gemini-3.5-flash' };
      throw new Error('sk-live-secret leaked from /tmp/path');
    }

    const generateContentStream = vi.fn(async () => brokenStream());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain('event: error');
    expect(body).toContain('"type":"server_error"');
    expect(body).toContain('"message":"Internal gateway error."');
    expect(body).not.toContain('sk-live-secret');
    expect(body).not.toContain('/tmp/path');
    expect(body).not.toContain('"success":false');
    expect(body).not.toContain('"code":"INTERNAL"');
  });

  it('returns a regular JSON error when the upstream stream fails before the first SSE frame', async () => {
    const brokenStream = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw new Error('boom before first frame');
        },
      }),
    };

    const generateContentStream = vi.fn(async () => brokenStream);
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.type).toBe('server_error');
    expect(body.error.message).toBe('Internal gateway error.');
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });

  it('stops downstream streaming and cleans up the upstream iterator when the client disconnects', async () => {
    let resolvePause!: () => void;
    let returnCalled = false;
    const pause = new Promise<void>((resolve) => {
      resolvePause = resolve;
    });
    const iterator: AsyncIterator<Record<string, unknown>> = {
      async next() {
        if (!returnCalled) {
          returnCalled = true;
          return {
            done: false,
            value: { candidates: [{ content: { parts: [{ text: 'first' }] } }], modelVersion: 'gemini-3.5-flash' },
          };
        }
        await pause;
        return {
          done: false,
          value: { candidates: [{ content: { parts: [{ text: 'second' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-3.5-flash' },
        };
      },
      async return() {
        returnCalled = true;
        resolvePause();
        return { done: true, value: undefined };
      },
    };
    const iterable = {
      [Symbol.asyncIterator]: () => iterator,
    };
    const returnSpy = vi.spyOn(iterator, 'return');
    const generateContentStream = vi.fn(async () => iterable);
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream } }) });
    const baseUrl = await listen(server);
    const controller = new AbortController();

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
      signal: controller.signal,
    });

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(new TextDecoder().decode(firstChunk.value)).toContain('"delta":{"role":"assistant","content":"first"}');

    controller.abort();
    await vi.waitFor(() => {
      expect(returnSpy).toHaveBeenCalled();
    });
  });

  it('rejects unsupported OpenAI-compatible streaming tool requests before opening SSE', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
        tools: [{
          type: 'function',
          function: {
            name: 'lookup',
            parameters: { type: 'object' },
          },
        }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.code).toBe('invalid_value');
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toMatch(/tool calls/i);
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

  it('returns a 501 JSON error when the configured GenAI client does not support streaming', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.code).toBe('invalid_value');
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toMatch(/streaming is not implemented/i);
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects OpenAI-compatible streaming requests with n greater than one before opening SSE', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        n: 2,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.code).toBe('invalid_value');
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toMatch(/n: 1/i);
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateContentStream).not.toHaveBeenCalled();
  });

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
    expect(body.error.type).toBe('rate_limit_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });
});
