export function parseModelCatalogAliases(aliasesJson: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(aliasesJson) as unknown;
  } catch {
    throw new Error('Invalid aliases JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid aliases JSON');
  }

  for (const value of Object.values(parsed)) {
    if (typeof value !== 'string') {
      throw new Error('Invalid aliases JSON');
    }
  }

  return parsed as Record<string, string>;
}
