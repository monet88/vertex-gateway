import type { ProviderModelCatalog } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

const BUILT_IN_PROVIDER_MODELS: Record<string, string[]> = {
  gemini: [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-omni-flash-preview',
    'veo-3.1-generate-001',
    'veo-3.1-fast-generate-001',
    'veo-3.1-lite-generate-001-preview',
    'chirp-3',
    'chirp-3-hd',
    'chirp-3-instant-custom-voice',
    'gemini-embedding-2',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3.1-flash-image-preview',
    'gemini-3.1-flash-lite-image',
    'gemini-3-pro-image',
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
  ],
};

export const getProviderBuiltInModels = (provider: string): string[] => [
  ...(BUILT_IN_PROVIDER_MODELS[provider] ?? []),
];

export const getProviderModelCatalog = (
  modelCatalog: Record<string, ProviderModelCatalog>,
  provider: string,
): ProviderModelCatalog => modelCatalog[provider] ?? {
  aliases: {},
  allowlist: [],
  disabled: [],
};

export const resolveProviderModel = (
  modelCatalog: Record<string, ProviderModelCatalog>,
  provider: string,
  requestedModel: unknown,
): string | undefined => {
  const catalog = getProviderModelCatalog(modelCatalog, provider);
  const requested = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  if (!requested) {
    return undefined;
  }
  const resolved = catalog.aliases[requested] || requested;
  const disabled = new Set(catalog.disabled);
  if (disabled.has(requested) || disabled.has(resolved)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', `Model is disabled for provider ${provider}: ${requested}`);
  }
  if (catalog.allowlist.length > 0 && !catalog.allowlist.includes(resolved)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', `Model is not allowed for provider ${provider}: ${requested}`);
  }
  return resolved;
};

const isDiscoverableModel = (
  catalog: ProviderModelCatalog,
  name: string,
): boolean => {
  const resolved = catalog.aliases[name] || name;
  const disabled = new Set(catalog.disabled);
  if (disabled.has(name) || disabled.has(resolved)) {
    return false;
  }
  return catalog.allowlist.length === 0 || catalog.allowlist.includes(resolved);
};

export const listProviderRouteModels = (
  modelCatalog: Record<string, ProviderModelCatalog>,
  provider: string,
): Array<{ name: string }> => {
  const catalog = getProviderModelCatalog(modelCatalog, provider);
  const names = [
    ...getProviderBuiltInModels(provider),
    ...(catalog.defaultModel ? [catalog.defaultModel] : []),
    ...catalog.allowlist,
    ...Object.keys(catalog.aliases),
  ];
  const seen = new Set<string>();
  return names
    .filter((name) => {
      if (seen.has(name) || !isDiscoverableModel(catalog, name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .map((name) => ({ name }));
};
