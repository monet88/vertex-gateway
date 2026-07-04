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

const parseSseDataFrames = (body: string): Array<Record<string, unknown> | '[DONE]'> => body
  .split('\n\n')
  .filter(Boolean)
  .map((frame) => {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!dataLine) throw new Error(`Missing data line in frame: ${frame}`);
    const data = dataLine.slice('data: '.length);
    return data === '[DONE]' ? '[DONE]' : JSON.parse(data) as Record<string, unknown>;
  });

const parseSseEventNames = (body: string): string[] => body
  .split('\n\n')
  .filter(Boolean)
  .flatMap((frame) => frame.split('\n').filter((line) => line.startsWith('event: ')).map((line) => line.slice('event: '.length)));

describe('openai responses routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    vi.restoreAllMocks();
  });

  it('returns a compatible non-streaming response for string input', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{
        content: { parts: [{ text: 'ok' }] },
      }],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 1,
        totalTokenCount: 6,
      },
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const client = createOpenAiTestClient(`${baseUrl}/openai/v1`);

    const response = await client.responses.create({
      model: 'gemini-3.5-flash',
      input: 'Reply with exactly ok',
    });

    expect(response.object).toBe('response');
    expect(response.status).toBe('completed');
    expect(response.output_text).toBe('ok');
    expect(response.output[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok' }],
    });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Reply with exactly ok' }] }],
    }), expect.objectContaining({ routeFamily: 'openai-responses', signal: expect.any(AbortSignal) }));
  });

  it('maps message-array input, instructions, and custom function tool choice into Gemini config', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: 'lookup',
              args: { id: '42' },
            },
          }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 2,
        totalTokenCount: 9,
      },
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        instructions: 'Be concise.',
        tool_choice: { type: 'function', name: 'lookup' },
        input: [
          { type: 'message', role: 'developer', content: 'Prefer IDs only.' },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Lookup order 42' }] },
        ],
        tools: [{
          type: 'function',
          name: 'lookup',
          description: 'Lookup data',
          parameters: { type: 'object', properties: { id: { type: 'string' } } },
        }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call',
        name: 'lookup',
        arguments: JSON.stringify({ id: '42' }),
      }),
    ]));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Lookup order 42' }] }],
      config: {
        systemInstruction: { parts: [{ text: 'Be concise.' }, { text: 'Prefer IDs only.' }] },
        tools: [{
          functionDeclarations: [{
            name: 'lookup',
            description: 'Lookup data',
            parameters: { type: 'object', properties: { id: { type: 'string' } } },
          }],
        }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: ['lookup'],
          },
        },
      },
    }), expect.objectContaining({ routeFamily: 'openai-responses', signal: expect.any(AbortSignal) }));
  });

  it('rejects unsupported built-in tools before calling Gemini', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: 'hello',
        tools: [{ type: 'web_search_preview' }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('invalid_value');
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.message).toMatch(/custom function tools/i);
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects unsupported tool_choice and parallel_tool_calls before calling Gemini', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const invalidToolChoice = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: 'hello',
        tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
        tool_choice: 'bogus',
      }),
    });
    const invalidToolChoiceBody = await invalidToolChoice.json();

    expect(invalidToolChoice.status).toBe(400);
    expect(invalidToolChoiceBody.error.message).toMatch(/tool_choice/i);

    const parallelToolCalls = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: 'hello',
        parallel_tool_calls: true,
      }),
    });
    const parallelToolCallsBody = await parallelToolCalls.json();

    expect(parallelToolCalls.status).toBe(400);
    expect(parallelToolCallsBody.error.message).toMatch(/parallel_tool_calls/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects tool_choice when no tools are supplied', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: 'hello',
        tool_choice: 'auto',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/tool_choice requires custom function tools/i);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('accepts Responses image inputs with embedded base64 whitespace', async () => {
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{
        content: { parts: [{ text: 'ok' }] },
      }],
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: 'data:image/png;base64,YW Jj\nZA==' }],
        }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('streams semantic Responses events with exact delta fields and monotonic sequence numbers', async () => {
    async function* streamChunks() {
      yield {
        modelVersion: 'gemini-3.5-flash',
        candidates: [{ content: { parts: [{ text: 'hel' }] } }],
      };
      yield {
        modelVersion: 'gemini-3.5-flash',
        candidates: [{ content: { parts: [{ text: 'lo' }] } }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          totalTokenCount: 7,
        },
      };
    }

    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        input: 'hello',
      }),
    });
    const body = await response.text();
    const frames = parseSseDataFrames(body);
    const eventNames = parseSseEventNames(body);
    const events = frames.slice(0, -1) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(frames.at(-1)).toBe('[DONE]');
    expect(events.map((event) => event.type)).toEqual([
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(eventNames).toEqual([
      'response.created',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(events[3]).toMatchObject({
      type: 'response.output_text.delta',
      item_id: expect.any(String),
      output_index: 0,
      content_index: 0,
      delta: 'hel',
      sequence_number: 3,
    });
    expect(events[4]).toMatchObject({
      type: 'response.output_text.delta',
      item_id: expect.any(String),
      output_index: 0,
      content_index: 0,
      delta: 'lo',
      sequence_number: 4,
    });
    expect(events[8]).toMatchObject({
      type: 'response.completed',
      response: expect.objectContaining({
        object: 'response',
        status: 'completed',
        output_text: 'hello',
      }),
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    }), expect.objectContaining({
      routeFamily: 'openai-responses',
      signal: expect.any(AbortSignal),
      streamGuard: {
        idleTimeoutMs: 250,
        maxDurationMs: 10000,
      },
    }));
  });

  it('does not emit scaffold SSE frames before the first upstream chunk succeeds', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => ({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error('upstream unavailable');
          },
        };
      },
    }));

    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        input: 'hello',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.error.code).toBe('internal_error');
    expect(body.error.type).toBe('server_error');
    expect(body.error.message).toMatch(/unavailable/i);
    expect(body.success).toBeUndefined();
    expect(body.requestId).toBeUndefined();
  });

  it('closes an empty Responses stream with a terminal DONE frame', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
      }),
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        stream: true,
        input: 'hello',
      }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(body.trim()).toBe('data: [DONE]');
  });

  it('is consumable by the OpenAI SDK against the local responses route for non-streaming and streaming', async () => {
    async function* streamChunks() {
      yield {
        modelVersion: 'gemini-3.5-flash',
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 1,
          totalTokenCount: 4,
        },
      };
    }

    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 1,
        totalTokenCount: 4,
      },
    }));
    const generateContentStream = vi.fn(async () => streamChunks());
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent, generateContentStream } }) });
    const baseUrl = await listen(server);
    const client = createOpenAiTestClient(`${baseUrl}/openai/v1`);

    const response = await client.responses.create({
      model: 'gemini-3.5-flash',
      input: 'Reply with exactly ok',
    });
    expect(response.output_text).toBe('ok');

    const stream = await client.responses.create({
      model: 'gemini-3.5-flash',
      input: 'Reply with exactly ok',
      stream: true,
    });
    const eventTypes: string[] = [];
    const deltas: string[] = [];
    for await (const event of stream) {
      eventTypes.push(event.type);
      if (event.type === 'response.output_text.delta') deltas.push(event.delta);
    }

    expect(eventTypes).toContain('response.created');
    expect(eventTypes).toContain('response.output_text.delta');
    expect(eventTypes).toContain('response.completed');
    expect(deltas.join('')).toBe('ok');
  });
});
