import { GatewayError } from '../http/error-response.js';

export interface StreamGuardOptions {
  idleTimeoutMs: number;
  maxDurationMs: number;
  startedAt: number;
}

export const nextStreamStep = async <T>(
  iterator: AsyncIterator<T>,
  options: StreamGuardOptions,
): Promise<IteratorResult<T>> => {
  const elapsed = Date.now() - options.startedAt;
  const remainingDurationMs = options.maxDurationMs - elapsed;
  if (remainingDurationMs <= 0) {
    throw new GatewayError(504, 'TIMEOUT', 'Stream exceeded maximum lifetime.', true);
  }

  const timeoutMs = Math.min(options.idleTimeoutMs, remainingDurationMs);
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new GatewayError(504, 'TIMEOUT', 'Stream timed out waiting for the next chunk.', true));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
