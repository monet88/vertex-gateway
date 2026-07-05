import { describe, expect, it } from 'vitest';
import { listProviderRouteModels } from '../src/admin/model-store.js';

describe('model store route listing', () => {
  it('builds discoverable provider models from built-ins and catalog rules', () => {
    const models = listProviderRouteModels({
      gemini: {
        defaultModel: 'gemini-2.5-flash',
        aliases: {
          fast: 'gemini-2.5-flash',
          disabledAlias: 'gemini-3.1-pro-preview',
        },
        allowlist: ['gemini-2.5-flash'],
        disabled: ['gemini-3.1-pro-preview'],
      },
    }, 'gemini');

    expect(models).toEqual([
      { name: 'gemini-2.5-flash' },
      { name: 'fast' },
    ]);
  });
});
