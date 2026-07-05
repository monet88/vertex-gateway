import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

const isLocalOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const setCorsHeaders = (res: ServerResponse, origin: string): void => {
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader(
    'access-control-allow-headers',
    'authorization, content-type, x-api-key, x-goog-api-key, x-goog-api-client, x-request-id',
  );
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
};

export const applyCors = (req: IncomingMessage, res: ServerResponse, config: GatewayConfig): void => {
  const origin = req.headers.origin;
  if (!origin) return;
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) {
    setCorsHeaders(res, origin);
    return;
  }
  const wildcardAllowed = config.corsOrigins.includes('*');
  if (wildcardAllowed && !config.allowWildcardCors && !isLocalOrigin(origin)) {
    throw new GatewayError(403, 'CORS_DENIED', 'Wildcard CORS is disabled for non-local origins.');
  }
  if (!wildcardAllowed) {
    throw new GatewayError(403, 'CORS_DENIED', 'Origin is not allowed.');
  }
  setCorsHeaders(res, origin);
};
