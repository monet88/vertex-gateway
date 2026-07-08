import type { GatewayConfig } from '../config/env.js';
import { persistAdminFileStoreSettings, readAdminFileStoreSettings } from '../config/admin-settings-store.js';

export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const isFreshAdminSessionToken = (createdAt: string | null | undefined): boolean => {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  const age = Date.now() - createdMs;
  return age >= 0 && age <= ADMIN_SESSION_TTL_MS;
};

export const readPersistedAdminSessionToken = (config: GatewayConfig): string => {
  if (config.adminStoreMode !== 'file-store' || !config.adminFileStoreDir) {
    return '';
  }
  const settings = readAdminFileStoreSettings(config);
  return typeof settings.adminSessionToken === 'string'
    ? settings.adminSessionToken.trim()
    : '';
};

export const clearPersistedAdminSessionToken = (config: GatewayConfig): void => {
  if (config.adminStoreMode !== 'file-store' || !config.adminFileStoreDir) {
    return;
  }
  persistAdminFileStoreSettings(config, {
    adminSessionToken: null,
    adminSessionTokenCreatedAt: null,
  });
};
