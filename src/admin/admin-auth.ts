import { createHash, timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { readAdminFileStoreSettings } from '../config/admin-settings-store.js';
import { clearPersistedAdminSessionToken, isFreshAdminSessionToken, readPersistedAdminSessionToken } from './admin-session.js';

export const extractAdminBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const safeCompare = (left: string, right: string): boolean => {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
};

const clearExpiredAdminSessionIfNeeded = (token: string, config: GatewayConfig): void => {
  const sessionToken = readPersistedAdminSessionToken(config);
  if (!sessionToken || !safeCompare(token, sessionToken)) {
    return;
  }
  const settings = config.adminStoreMode === 'file-store' && config.adminFileStoreDir
    ? readAdminFileStoreSettings(config)
    : null;
  if (isFreshAdminSessionToken(settings?.adminSessionTokenCreatedAt)) {
    return;
  }
  clearPersistedAdminSessionToken(config);
  throw new GatewayError(401, 'AUTH_INVALID', 'Admin authorization failed.');
};

export const requireAdminAuth = (
  headers: Record<string, string | string[] | undefined>,
  config: GatewayConfig,
): void => {
  const authorization = typeof headers.authorization === 'string'
    ? headers.authorization
    : undefined;
  const token = extractAdminBearerToken(authorization);
  if (!token || !config.adminToken || !safeCompare(token, config.adminToken)) {
    throw new GatewayError(401, 'AUTH_INVALID', 'Admin authorization failed.');
  }
  clearExpiredAdminSessionIfNeeded(token, config);
};
