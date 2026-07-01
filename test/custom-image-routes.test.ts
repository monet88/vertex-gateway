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

describe('custom image routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it('normalizes inline image responses for /api/images/generate', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'dress', numberOfImages: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images[0]).toMatchObject({ dataUrl: 'data:image/png;base64,abc', mimeType: 'image/png' });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-image-preview' }));
  });

  it('dispatches one generate request for each requested output image', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'one', mimeType: 'image/png' } }] } }] })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'two', mimeType: 'image/png' } }] } }] });
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/generate`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'dress', numberOfImages: 2, aspectRatio: '16:9' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images.map((image: { index: number; dataUrl: string }) => ({ index: image.index, dataUrl: image.dataUrl }))).toEqual([
      { index: 0, dataUrl: 'data:image/png;base64,one' },
      { index: 1, dataUrl: 'data:image/png;base64,two' },
    ]);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
    }));
  });

  it('honors edit image count and image config options', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'edit-one', mimeType: 'image/png' } }] } }] })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'edit-two', mimeType: 'image/png' } }] } }] });
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/edit`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'edit',
        images: [{ mimeType: 'image/png', data: 'YWJj' }],
        numberOfImages: 2,
        aspectRatio: '1:1',
        resolution: '2K',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images.map((image: { index: number; dataUrl: string }) => ({ index: image.index, dataUrl: image.dataUrl }))).toEqual([
      { index: 0, dataUrl: 'data:image/png;base64,edit-one' },
      { index: 1, dataUrl: 'data:image/png;base64,edit-two' },
    ]);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: [{
        role: 'user',
        parts: [
          { text: 'edit' },
          { inlineData: { mimeType: 'image/png', data: 'YWJj' } },
        ],
      }],
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '2K' } },
    }));
  });

  it('rejects oversize input images before upstream work', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig({ maxDecodedImageBytes: 2 }), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/edit`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'edit', images: [{ mimeType: 'image/png', data: 'abcdef' }] }),
    });
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects non-object image entries before upstream work', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/edit`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'edit', images: [null] }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toBe('Each image must be an object.');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('uses the stable default image model for /api/images/upscale', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/api/images/upscale`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        image: { mimeType: 'image/png', data: 'YWJj' },
        quality: '2K',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images[0]).toMatchObject({ dataUrl: 'data:image/png;base64,abc', mimeType: 'image/png' });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-image-preview' }));
  });
});
