import { describe, expect, it } from 'vitest';

const catalogLoadErrorMessage = (errors: readonly string[], loadedCatalogCount: number): string | null => {
  if (errors.length === 0) {
    return null;
  }

  const prefix = loadedCatalogCount === 0 ? 'Failed to load catalog' : 'Partial load';
  return `${prefix}: ${errors.join('; ')}`;
};

describe('available models view load errors', () => {
  it('labels complete provider failures as a load failure instead of a partial load', () => {
    expect(catalogLoadErrorMessage(['gemini down', 'openai down'], 0)).toBe(
      'Failed to load catalog: gemini down; openai down',
    );
  });

  it('keeps the partial load label when at least one provider catalog succeeds', () => {
    expect(catalogLoadErrorMessage(['openai down'], 1)).toBe('Partial load: openai down');
  });
});