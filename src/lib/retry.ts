import { classifyUpstreamError } from './upstream-error-classifier.js';

export const isTransientError = (error: unknown): boolean =>
  classifyUpstreamError(error).retryable;

// Spec §5: exponential backoff + full jitter (standard AWS formula).
// delay = random(0, min(base * 2^attempt, cap)).
// Base default 250ms to avoid thundering herd on Google 429 responses.
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number, baseDelayMs: number): number => {
  const exponential = Math.min(baseDelayMs * 2 ** Math.min(attempt, 20), BACKOFF_CAP_MS);
  return Math.floor(Math.random() * exponential);
};

export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry: (error: unknown) => boolean = isTransientError,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
  signal?: AbortSignal,
): Promise<{ value: T; retries: number }> => {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return { value: await task(), retries: attempt };
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = computeBackoffMs(attempt, baseDelayMs);
      attempt += 1;
      if (delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          };
          const timer = setTimeout(() => {
            if (signal) {
              signal.removeEventListener('abort', onAbort);
            }
            resolve();
          }, delay);
          if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        });
      }
    }
  }
};
