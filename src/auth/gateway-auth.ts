import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { verifyManagedGatewayKey } from '../admin/gateway-key-store.js';

const constantTimeEqual = (left: string, right: string): boolean => {
  // Prevent timing attacks by ensuring consistent lengths via hashing
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
};

export const extractGatewayKey = (req: IncomingMessage): string | null => {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKey = Array.isArray(req.headers['x-api-key']) ? req.headers['x-api-key'][0] : req.headers['x-api-key'];
  const googApiKey = Array.isArray(req.headers['x-goog-api-key']) ? req.headers['x-goog-api-key'][0] : req.headers['x-goog-api-key'];
  return bearer || apiKey?.trim() || googApiKey?.trim() || null;
};

export const requireGatewayAuth = (req: IncomingMessage, config: GatewayConfig): void => {
  const candidate = extractGatewayKey(req);
  if (!candidate) throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is required.');
  if (config.gatewayKeys.some((key) => constantTimeEqual(candidate, key))) return;
  if (config.managedGatewayKeyHashes.length > 0 && verifyManagedGatewayKey(candidate, config.managedGatewayKeyHashes)) return;
  throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is invalid.');
};
