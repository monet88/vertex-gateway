import { Readable } from 'node:stream';
import { request, type IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { readJsonBody } from '../src/lib/read-json.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const requestWithBody = async (
  url: string,
  method: string,
  body: string,
): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
  const req = request(url, {
    method,
    headers: {
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    res.on('end', () => resolve({
      status: res.statusCode ?? 0,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  req.on('error', reject);
  req.end(body);
});

describe('readJsonBody', () => {
  it('returns the 413 error when request streams exceed the JSON limit', async () => {
    const req = Readable.from([Buffer.from('{"oversized":true}')]) as IncomingMessage;

    await expect(readJsonBody(req, 2)).rejects.toMatchObject({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('sends a JSON 413 response for oversized HTTP request bodies', async () => {
    const generateContent = vi.fn();
    const server = createApp({
      config: testConfig({ maxJsonBytes: 8 }),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    try {
      const response = await fetch(`${baseUrl}/api/images/generate`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'oversized' }),
      });
      const body = await response.json();

      expect(response.status).toBe(413);
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(generateContent).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not parse JSON bodies on GET routes', async () => {
    const generateContent = vi.fn();
    const server = createApp({
      config: testConfig(),
      genAiFactory: () => ({ models: { generateContent } }),
    });
    const baseUrl = await listen(server);

    try {
      const response = await requestWithBody(`${baseUrl}/openai/v1/models`, 'GET', '\n');
      const body = JSON.parse(response.body);

      expect(response.status).toBe(200);
      expect(body.object).toBe('list');
      expect(generateContent).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
