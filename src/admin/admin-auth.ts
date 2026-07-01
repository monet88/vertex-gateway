import { createHash, timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

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
};
