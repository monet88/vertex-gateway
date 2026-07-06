import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

describe('removed custom API routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it('rejects custom image and session routes before upstream work', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    for (const pathname of [
      '/api/images/generate',
      '/api/images/edit',
      '/api/images/upscale',
      '/api/images/describe',
      '/api/session/validate',
    ]) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'test' }),
      });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
    }

    expect(generateContent).not.toHaveBeenCalled();
  });
});
