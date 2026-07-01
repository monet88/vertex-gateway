import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  id: string;
  startedAt: number;
  path: string;
  method: string;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

const redact = (fields: Record<string, unknown> = {}): Record<string, unknown> => {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    redacted[key] = /token|key|authorization|base64|data/i.test(key) ? '[redacted]' : value;
  }
  return redacted;
};

export const createRequestContext = (req: IncomingMessage, res: ServerResponse): RequestContext => {
  const id = String(req.headers['x-request-id'] ?? randomUUID());
  res.setHeader('x-request-id', id);
  return {
    id,
    startedAt: Date.now(),
    path: req.url ?? '/',
    method: req.method ?? 'GET',
    log: (event, fields = {}) => {
      console.info(JSON.stringify({
        event,
        requestId: id,
        method: req.method,
        path: req.url,
        ...redact(fields),
      }));
    },
  };
};
