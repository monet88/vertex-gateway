import { classifyUpstreamError } from './upstream-error-classifier.js';

export const isTransientError = (error: unknown): boolean =>
  classifyUpstreamError(error).retryable;

// Spec §5: exponential backoff + full jitter. Base default raised from 100ms to
// 250ms because 100ms linear was too aggressive for Google 429 responses and
// risked a thundering herd. delay = min(base * 2**attempt, cap) + random(0, base).
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const BACKOFF_CAP_MS = 30_000;

export const computeBackoffMs = (attempt: number, baseDelayMs: number): number => {
  const exponential = Math.min(baseDelayMs * 2 ** Math.min(attempt, 20), BACKOFF_CAP_MS);
  return exponential + Math.floor(Math.random() * baseDelayMs);
};

export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry: (error: unknown) => boolean = isTransientError,
  baseDelayMs: number = DEFAULT_RETRY_BASE_DELAY_MS,
): Promise<{ value: T; retries: number }> => {
  let attempt = 0;
  for (;;) {
    try {
      return { value: await task(), retries: attempt };
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      const delay = computeBackoffMs(attempt, baseDelayMs);
      attempt += 1;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
};
