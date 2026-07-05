import { EventEmitter } from 'node:events';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { testConfig } from './test-config.js';

class FakeRequest extends EventEmitter {
  method = 'GET';
  url = '/';
  headers: Record<string, string> = {};
  destroy = vi.fn();
}

class FakeResponse extends EventEmitter {
  statusCode = 0;
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  readonly endCalls: Array<string | undefined> = [];
  readonly headerCalls: Array<[string, string]> = [];

  constructor(private readonly failAfterHeaders = true) {
    super();
  }

  setHeader(name: string, value: string): void {
    this.headerCalls.push([name, value]);
  }

  once(eventName: string | symbol, listener: (...args: Array<unknown>) => void): this {
    return super.once(eventName, listener);
  }

  off(eventName: string | symbol, listener: (...args: Array<unknown>) => void): this {
    return super.off(eventName, listener);
  }

  end(chunk?: string): void {
    this.endCalls.push(chunk);
    if (!this.headersSent) {
      this.headersSent = true;
      if (this.failAfterHeaders) {
        throw new Error('socket write failed after headers');
      }
    }
    this.writableEnded = true;
  }
}

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

describe('app error fallback', () => {
  it('does not append a JSON error payload after headers were already sent', async () => {
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent: vi.fn() } }),
    });
    const handler = server.listeners('request')[0] as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<void>;

    const req = new FakeRequest();
    const res = new FakeResponse();

    await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.endCalls).toHaveLength(2);
    expect(res.endCalls[0]).toContain('"message":"Chang Store Vertex Gateway"');
    expect(res.endCalls[1]).toBeUndefined();
    expect(res.endCalls.join(' ')).not.toContain('"success":false');
    expect(
      res.headerCalls.filter(([name]) => name.toLowerCase() === 'content-type'),
    ).toHaveLength(1);
  });
});

describe('app model aliasing', () => {
  it('answers CORS preflight from arbitrary browser origins by default', async () => {
    const generateContent = vi.fn(async () => ({}));
    const server = createApp({
      config: testConfig({ corsOrigins: [] }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.1-flash-image:generateContent`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://changstore-da7p92082-monet421992.vercel.app',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, x-goog-api-client',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://changstore-da7p92082-monet421992.vercel.app',
    );
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS');
    expect(generateContent).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns discoverable Gemini route models from built-ins and the configured catalog', async () => {
    const generateContent = vi.fn(async () => ({}));
    const server = createApp({
      config: testConfig({
        modelCatalog: {
          gemini: {
            defaultModel: 'gemini-2.5-flash',
            aliases: {
              fast: 'gemini-2.5-flash',
              disabledAlias: 'gemini-3.1-pro-preview',
            },
            allowlist: ['gemini-2.5-flash'],
            disabled: ['gemini-3.1-pro-preview'],
          },
        },
      }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/gemini/v1beta/models`, {
      headers: { authorization: 'Bearer test-key' },
    });
    const body = await response.json();
    const modelNames = body.models.map((item: { name: string }) => item.name);

    expect(response.status).toBe(200);
    expect(modelNames).toEqual(['gemini-2.5-flash', 'fast']);
    expect(generateContent).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rewrites direct Gemini route models through the configured alias map', async () => {
    const generateContent = vi.fn(async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
    const server = createApp({
      config: testConfig({
        modelCatalog: {
          gemini: {
            aliases: { 'gemini-3.1-pro': 'gemini-3.1-pro-preview' },
            allowlist: [],
            disabled: [],
          },
        },
      }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.1-pro:generateContent`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }] }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-pro-preview' }),
      expect.objectContaining({ routeFamily: 'gemini' }),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rewrites custom image route body models through the configured alias map', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/png' } }] } }],
    }));
    const server = createApp({
      config: testConfig({
        modelCatalog: {
          gemini: {
            aliases: { 'gemini-3.1-flash-image': 'gemini-3.1-flash-image-preview' },
            allowlist: [],
            disabled: [],
          },
        },
      }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/edit`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image',
        prompt: 'edit',
        images: [{ mimeType: 'image/png', data: 'YWJj' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-flash-image-preview' }),
      expect.objectContaining({ routeFamily: 'images' }),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('does not inject default model into custom image routes when the client omitted model', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/png' } }] } }],
    }));
    const server = createApp({
      config: testConfig({
        modelCatalog: {
          gemini: {
            defaultModel: 'gemini-2.5-flash',
            aliases: {},
            allowlist: [],
            disabled: [],
          },
        },
      }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/edit`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'edit',
        images: [{ mimeType: 'image/png', data: 'YWJj' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-flash-image-preview' }),
      expect.objectContaining({ routeFamily: 'images' }),
    );
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects disabled and non-allowlisted provider models before calling upstream', async () => {
    const generateContent = vi.fn(async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
    const server = createApp({
      config: testConfig({
        modelCatalog: {
          gemini: {
            aliases: { 'gemini-3.1-pro': 'gemini-3.1-pro-preview' },
            allowlist: ['gemini-2.5-flash'],
            disabled: ['gemini-3.1-pro-preview'],
          },
        },
      }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.1-pro:generateContent`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }] }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(generateContent).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe('public docs origin rendering', () => {
  it('falls back to the canonical docs origin when forwarded headers are unsafe', async () => {
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent: vi.fn() } }),
    });
    const handler = server.listeners('request')[0] as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<void>;

    const req = new FakeRequest();
    req.url = '/docs';
    req.headers = {
      host: 'vertex.monet.uno"><svg/onload=alert(1)>',
      'x-forwarded-proto': 'javascript',
    };
    const res = new FakeResponse(false);

    await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.endCalls[0]).toContain('https://vertex.monet.uno/openai/v1/chat/completions');
    expect(res.endCalls[0]).not.toContain('<svg/onload=alert(1)>');
    expect(res.endCalls[0]).not.toContain('javascript://');
  });

  it('uses validated host and forwarded proto for docs surfaces', async () => {
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent: vi.fn() } }),
    });
    const handler = server.listeners('request')[0] as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<void>;

    const req = new FakeRequest();
    req.url = '/llms.txt';
    req.headers = {
      host: '127.0.0.1:4312',
      'x-forwarded-proto': 'http',
    };
    const res = new FakeResponse(false);

    await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);

    expect(res.endCalls[0]).toContain('http://127.0.0.1:4312/docs');
    expect(res.endCalls[0]).toContain('Authorization: Bearer YOUR_GATEWAY_KEY');
  });
});
