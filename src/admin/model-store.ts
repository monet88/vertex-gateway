import type { ProviderModelCatalog } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

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
