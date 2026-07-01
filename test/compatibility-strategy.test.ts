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

  it('uses the URL route model for predict requests with instances', async () => {
    const generateContent = vi.fn(async () => ({}));

    await runCompatibilityRoute(
      {
        family: 'vertex',
        operation: 'predict',
        model: 'url-predict-model',
        stateful: true,
        stream: false,
      } satisfies ClassifiedRoute,
      {
        model: 'body-predict-model',
        instances: [{ prompt: 'hello' }],
      },
      { models: { generateContent } },
    );

    expect(generateContent).toHaveBeenCalledWith(
      {
        model: 'url-predict-model',
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      },
      expect.objectContaining({ routeFamily: 'vertex' }),
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

  it('omits streamGuard when no streamConfig is given to runCompatibilityStreamRoute', async () => {
    const generateContentStream = vi.fn(async () => ({ [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; } }));

    const { runCompatibilityStreamRoute } = await import('../src/strategies/compatibility-strategy.js');

    await runCompatibilityStreamRoute(
      { family: 'vertex', operation: 'streamGenerateContent', model: 'gemini-2.5-flash', stateful: true, stream: true } satisfies ClassifiedRoute,
      { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] },
      { models: { generateContentStream } },
    );

    const [, metadata] = generateContentStream.mock.calls[0];
    expect(metadata.streamGuard).toBeUndefined();
    expect(metadata.routeFamily).toBe('vertex');
  });
});
