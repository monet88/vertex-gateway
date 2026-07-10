import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { GatewayConfig } from '../config/env.js';
import {
  hasAlignedGatewayKeyDigests,
  hashGatewayKeyDigests,
} from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { verifyManagedGatewayKey } from '../admin/gateway-key-store.js';

const matchesStaticGatewayKey = (candidateDigest: Buffer, digests: readonly Buffer[]): boolean => {
  let matched = false;
  for (const digest of digests) {
    if (candidateDigest.length === digest.length && timingSafeEqual(candidateDigest, digest)) {
      matched = true;
    }
  }
  return matched;
};

/**
 * Hot-path digests: reuse prehashed buffers when shape-aligned; recompute only on
 * partial/mis-shaped configs. Never clone aligned digests per request.
 */
const digestsForAuth = (config: GatewayConfig): readonly Buffer[] => {
  const keys = config.gatewayKeys ?? [];
  if (hasAlignedGatewayKeyDigests(keys, config.gatewayKeyDigests)) {
    return config.gatewayKeyDigests;
  }
  return hashGatewayKeyDigests(keys);
};

export const extractGatewayKey = (req: IncomingMessage): string | null => {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKey = Array.isArray(req.headers['x-api-key']) ? req.headers['x-api-key'][0] : req.headers['x-api-key'];
  const googApiKey = Array.isArray(req.headers['x-goog-api-key']) ? req.headers['x-goog-api-key'][0] : req.headers['x-goog-api-key'];
  return bearer || apiKey?.trim() || googApiKey?.trim() || null;
};

/** Validates gateway auth and returns the extracted key (single extract for hot path). */
export const requireGatewayAuth = (req: IncomingMessage, config: GatewayConfig): string => {
  const candidate = extractGatewayKey(req);
  if (!candidate) throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is required.');
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const digests = digestsForAuth(config);
  if (matchesStaticGatewayKey(candidateDigest, digests)) return candidate;
  if ((config.managedGatewayKeyHashes?.length ?? 0) > 0
    && verifyManagedGatewayKey(candidate, config.managedGatewayKeyHashes)) {
    return candidate;
  }
  throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is invalid.');
};
