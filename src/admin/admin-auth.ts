import { createHash, timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { persistAdminFileStoreSettings, readAdminFileStoreSettings } from '../config/admin-settings-store.js';

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

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const isFreshAdminSessionToken = (createdAt: string | null | undefined): boolean => {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && Date.now() - createdMs <= ADMIN_SESSION_TTL_MS;
};

const clearExpiredAdminSessionIfNeeded = (token: string, config: GatewayConfig): void => {
  if (config.adminStoreMode !== 'file-store' || !config.adminFileStoreDir) {
    return;
  }
  const settings = readAdminFileStoreSettings(config);
  const sessionToken = typeof settings.adminSessionToken === 'string'
    ? settings.adminSessionToken.trim()
    : '';
  if (!sessionToken || !safeCompare(token, sessionToken)) {
    return;
  }
  if (isFreshAdminSessionToken(settings.adminSessionTokenCreatedAt)) {
    return;
  }
  persistAdminFileStoreSettings(config, {
    adminSessionToken: null,
    adminSessionTokenCreatedAt: null,
  });
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
