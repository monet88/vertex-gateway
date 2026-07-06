import { describe, expect, it, vi } from 'vitest';
import type { ClassifiedRoute } from '../src/http/request-classifier.js';
import { runCompatibilityRoute } from '../src/strategies/compatibility-strategy.js';

describe('compatibility strategy', () => {
  it('uses the URL route model over a conflicting body model', async () => {
    const generateContent = vi.fn(async () => ({}));

    await runCompatibilityRoute(
      {
        family: 'gemini',
        operation: 'generateContent',
        model: 'url-model',
        stateful: true,
        stream: false,
      } satisfies ClassifiedRoute,
      {
        model: 'body-model',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
      { models: { generateContent } },
    );

    expect(generateContent).toHaveBeenCalledWith(
      {
        model: 'url-model',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
      expect.objectContaining({ routeFamily: 'gemini' }),
    );
  });

  it('passes abortSignal metadata to compatibility sync calls', async () => {
    const generateContent = vi.fn(async () => ({}));
    const abortController = new AbortController();

    await runCompatibilityRoute(
      {
        family: 'gemini',
        operation: 'generateContent',
        model: 'url-model',
        stateful: true,
        stream: false,
      } satisfies ClassifiedRoute,
      {
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
      { models: { generateContent } },
      'req-123',
      abortController.signal,
    );

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'url-model' }),
      expect.objectContaining({
        routeFamily: 'gemini',
        requestId: 'req-123',
        signal: abortController.signal,
      }),
    );
  });

  it('passes streamGuard metadata when streamConfig is provided to runCompatibilityStreamRoute', async () => {
    const generateContentStream = vi.fn(async () => ({ [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } }));

    const { runCompatibilityStreamRoute } = await import('../src/strategies/compatibility-strategy.js');

    await runCompatibilityStreamRoute(
      { family: 'gemini', operation: 'streamGenerateContent', model: 'gemini-2.5-flash', stateful: true, stream: true } satisfies ClassifiedRoute,
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { models: { generateContentStream } },
      'req-123',
      { idleTimeoutMs: 5000, maxDurationMs: 60000 },
    );

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
      expect.objectContaining({
        routeFamily: 'gemini',
        requestId: 'req-123',
        streamGuard: { idleTimeoutMs: 5000, maxDurationMs: 60000 },
      }),
    );
  });

  it('passes abortSignal metadata to compatibility stream calls', async () => {
    const generateContentStream = vi.fn(async () => ({ [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } }));
    const abortController = new AbortController();

    const { runCompatibilityStreamRoute } = await import('../src/strategies/compatibility-strategy.js');

    await runCompatibilityStreamRoute(
      { family: 'gemini', operation: 'streamGenerateContent', model: 'gemini-2.5-flash', stateful: true, stream: true } satisfies ClassifiedRoute,
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { models: { generateContentStream } },
      'req-123',
      { idleTimeoutMs: 5000, maxDurationMs: 60000 },
      abortController.signal,
    );

    expect(generateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
      expect.objectContaining({
        routeFamily: 'gemini',
        requestId: 'req-123',
        streamGuard: { idleTimeoutMs: 5000, maxDurationMs: 60000 },
        signal: abortController.signal,
      }),
    );
  });

  it('omits streamGuard when no streamConfig is given to runCompatibilityStreamRoute', async () => {
    const generateContentStream = vi.fn(async () => ({ [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } }));

    const { runCompatibilityStreamRoute } = await import('../src/strategies/compatibility-strategy.js');

    await runCompatibilityStreamRoute(
      { family: 'gemini', operation: 'streamGenerateContent', model: 'gemini-2.5-flash', stateful: true, stream: true } satisfies ClassifiedRoute,
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { models: { generateContentStream } },
    );

    const [, metadata] = generateContentStream.mock.calls[0];
    expect(metadata.streamGuard).toBeUndefined();
    expect(metadata.routeFamily).toBe('gemini');
  });
});
