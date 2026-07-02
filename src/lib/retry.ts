import { classifyUpstreamError } from './upstream-error-classifier.js';

export const isTransientError = (error: unknown): boolean =>
  classifyUpstreamError(error).retryable;

export const retryWithJitter = async <T>(
  task: () => Promise<T>,
  retries: number,
  shouldRetry = isTransientError,
): Promise<{ value: T; retries: number }> => {
  let attempt = 0;
  for (;;) {
    try {
      return { value: await task(), retries: attempt };
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt + Math.floor(Math.random() * 75)));
    }
  }
};
