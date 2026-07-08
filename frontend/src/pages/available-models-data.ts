import type { ProviderModelCatalog } from '@/types/admin';

export interface AvailableModelsCatalog extends ProviderModelCatalog {
  readonly builtInModels?: readonly string[];
}

export interface CatalogModelRow {
  readonly provider: string;
  readonly model: string;
  readonly status: 'allowed' | 'disabled';
  readonly aliases: readonly string[];
  readonly isDefault: boolean;
}

export const buildAvailableModelRows = (
  provider: string,
  catalog: AvailableModelsCatalog,
): CatalogModelRow[] => {
  const statuses = new Map<string, 'allowed' | 'disabled'>();
  for (const model of catalog.builtInModels ?? []) {
    if (!statuses.has(model)) statuses.set(model, 'allowed');
  }
  for (const model of catalog.allowlist ?? []) statuses.set(model, 'allowed');
  for (const model of catalog.defaultModel ? [catalog.defaultModel] : []) {
    if (!statuses.has(model)) statuses.set(model, 'allowed');
  }
  for (const model of Object.values(catalog.aliases ?? {})) {
    if (!statuses.has(model)) statuses.set(model, 'allowed');
  }
  for (const model of catalog.disabled ?? []) statuses.set(model, 'disabled');

  return Array.from(statuses.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, status]) => ({
      provider,
      model,
      status,
      aliases: Object.entries(catalog.aliases ?? {})
        .filter(([, target]) => target === model)
        .map(([alias]) => alias)
        .sort(),
      isDefault: catalog.defaultModel === model,
    }));
};
