import type { Server } from 'node:http';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { GoogleGenAI } from '@google/genai';
import { createApp } from '../src/app.js';
import { sendSseStream } from '../src/http/sse-response.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

async function* streamChunks() {
  yield { candidates: [{ content: { parts: [{ text: 'hel' }] } }] };
  yield { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }] };
}

class FakeSseResponse extends EventEmitter {
  statusCode = 0;
  readonly headers = new Map<string, string>();
  write = vi.fn(() => false);
  end = vi.fn();
  flushHeaders = vi.fn();

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

describe('streaming compatibility routes', () => {
  it('streams Gemini-compatible streamGenerateContent responses as SSE chunks', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent, generateContentStream } }),
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-2.5-flash:streamGenerateContent`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(body).toContain('data: {"candidates":[{"content":{"parts":[{"text":"hel"}]}}]}');
      expect(body).toContain('data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP"}]}');
      expect(body).not.toContain('data: [DONE]');
      expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        __gatewayRouteFamily: 'gemini',
      }));
      expect(generateContent).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('streams Vertex-compatible streamGenerateContent responses as SSE chunks', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent, generateContentStream } }),
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/vertex/v1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(body).not.toContain('data: [DONE]');
      expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        __gatewayRouteFamily: 'vertex',
      }));
      expect(generateContent).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('stops waiting for drain when the client closes during backpressure', async () => {
    const chunks = (async function* () {
      yield { text: 'first' };
      yield { text: 'second' };
    })();
    const res = new FakeSseResponse();
    const sendPromise = sendSseStream(res as unknown as ServerResponse, chunks);

    await new Promise((resolve) => setImmediate(resolve));
    expect(res.write).toHaveBeenCalledTimes(1);
    res.emit('close');

    await expect(Promise.race([
      sendPromise.then(() => 'closed'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 50)),
    ])).resolves.toBe('closed');
  });

  it('is consumable by the Google Gemini SDK against the local gemini stream route', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent, generateContentStream } }),
    });
    const baseUrl = await listen(server);

    try {
      const client = new GoogleGenAI({
        apiKey: 'test-key',
        httpOptions: {
          baseUrl: `${baseUrl}/gemini`,
          apiVersion: 'v1beta',
        },
      });
      const stream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: 'hi',
      });
      let text = '';
      for await (const chunk of stream) {
        text += chunk.text ?? '';
      }

      expect(text).toBe('hello');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('is consumable by the Google Gemini SDK against the local vertex stream route', async () => {
    const generateContent = vi.fn();
    const generateContentStream = vi.fn(async () => streamChunks());
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent, generateContentStream } }),
    });
    const baseUrl = await listen(server);

    try {
      const client = new GoogleGenAI({
        apiKey: 'test-key',
        httpOptions: {
          baseUrl: `${baseUrl}/vertex/v1/projects/p/locations/us-central1/publishers/google`,
          apiVersion: '',
        },
      });
      const stream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: 'hi',
      });
      let text = '';
      for await (const chunk of stream) {
        text += chunk.text ?? '';
      }

      expect(text).toBe('hello');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('emits a sanitized SSE error when the native stream exceeds the idle timeout', async () => {
    async function* slowStream() {
      yield { candidates: [{ content: { parts: [{ text: 'hel' }] } }] };
      await new Promise((resolve) => setTimeout(resolve, 60));
      yield { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }] };
    }

    const server = createApp({
      config: testConfig({ streamIdleTimeoutMs: 20, streamMaxDurationMs: 200 }),
      genAiFactory: () => ({ models: { generateContent: vi.fn(), generateContentStream: async () => slowStream() } }),
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-2.5-flash:streamGenerateContent`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('data: {"candidates":[{"content":{"parts":[{"text":"hel"}]}}]}');
      expect(body).toContain('event: error');
      expect(body).toContain('"code":"TIMEOUT"');
      expect(body).not.toContain('data: [DONE]');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
