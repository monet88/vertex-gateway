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

describe('openai image routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it('returns OpenAI-style b64_json data for image generations', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-image',
        prompt: 'Generate a fashion image',
        n: 1,
        size: '1024x1024',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ b64_json: 'abc' }]);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
    }), expect.objectContaining({ routeFamily: 'images' }));
  });

  it('returns OpenAI-style b64_json data for JSON image edits with multiple inputs and outputs', async () => {
    const generateContent = vi.fn()
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'one', mimeType: 'image/png' } }] } }] })
      .mockResolvedValueOnce({ candidates: [{ content: { parts: [{ inlineData: { data: 'two', mimeType: 'image/png' } }] } }] });
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image',
        prompt: 'Edit the outfit',
        n: 2,
        size: '1536x1024',
        image: [
          'data:image/png;base64,YWJj',
          'data:image/jpeg;base64,ZGVm',
        ],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ b64_json: 'one' }, { b64_json: 'two' }]);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.1-flash-image',
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2' } },
    }), expect.objectContaining({ routeFamily: 'images' }));
  });

  it('supports multipart edit uploads for OpenAI-style clients', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const boundary = '----chang-store-test-boundary';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngemini-3-pro-image\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n1024x1792\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="look.png"\r\nContent-Type: image/png\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([{ b64_json: 'edited' }]);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3-pro-image',
      config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
    }), expect.objectContaining({ routeFamily: 'images' }));
  });

  it('applies configured image-model aliases for multipart edits before calling upstream', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({
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
    const boundary = '----chang-store-alias-boundary';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\ngemini-3.1-flash-image\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="look.png"\r\nContent-Type: image/png\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-3.1-flash-image-preview',
    }), expect.objectContaining({ routeFamily: 'images' }));
  });

  it('supports quoted multipart boundaries and filename-first content disposition headers', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const boundary = '----chang-store-quoted-boundary';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; filename="look.png"; name="image"\r\nContent-Type: image/png\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary="${boundary}"`,
      },
      body: multipartBody,
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('accepts multipart image content types case-insensitively and with parameters', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const boundary = '----chang-store-case-content-type';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="look.png"\r\nContent-Type: IMAGE/PNG; charset=binary\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('accepts multipart image parts without filename when the field name and content type are valid', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const boundary = '----chang-store-no-filename';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image"\r\nContent-Type: image/png\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('accepts base64 data URLs with embedded whitespace in JSON edits', async () => {
    const generateContent = vi.fn(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { data: 'edited', mimeType: 'image/png' } }] } }],
    }));
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.1-flash-image',
        prompt: 'Edit the outfit',
        image: 'data:image/png;base64,YW Jj\nZA==',
      }),
    });

    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('rejects unsupported multipart edit fields explicitly', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);
    const boundary = '----chang-store-invalid-multipart';
    const multipartBody = [
      `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nEdit this garment\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="mask"\r\n\r\nunsupported\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="look.png"\r\nContent-Type: image/png\r\n\r\nabc\r\n`,
      `--${boundary}--\r\n`,
    ].join('');

    const response = await fetch(`${baseUrl}/openai/v1/images/edits`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/mask/);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('rejects unsupported OpenAI image fields explicitly', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/openai/v1/images/generations`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-image',
        prompt: 'Generate',
        response_format: 'url',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message).toMatch(/response_format/);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
