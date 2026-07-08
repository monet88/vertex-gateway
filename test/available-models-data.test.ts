import { describe, expect, it } from 'vitest';
import { buildAvailableModelRows } from '../frontend/src/pages/available-models-data.js';

describe('available models data', () => {
  it('keeps built-in provider inventory visible even when no catalog rules are configured', () => {
    expect(buildAvailableModelRows('gemini', {
      builtInModels: ['gemini-3.5-flash', 'gemini-2.5-pro'],
      aliases: {},
      allowlist: [],
      disabled: [],
    })).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        status: 'allowed',
        aliases: [],
        isDefault: false,
      },
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        status: 'allowed',
        aliases: [],
        isDefault: false,
      },
    ]);
  });
});
