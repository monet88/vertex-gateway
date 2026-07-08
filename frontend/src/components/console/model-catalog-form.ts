export function parseModelCatalogAliases(aliasesJson: string): Record<string, string> {
  const trimmed = aliasesJson.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
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
