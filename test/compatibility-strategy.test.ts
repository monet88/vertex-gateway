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
});
