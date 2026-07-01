import type { IncomingMessage } from 'node:http';
import { GatewayError } from '../http/error-response.js';

export const readJsonBody = async <T>(req: IncomingMessage, maxBytes: number): Promise<T> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'JSON body exceeds gateway limit.');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Request body must be valid JSON.');
  }
};
