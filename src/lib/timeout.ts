import { GatewayError } from '../http/error-response.js';

export const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new GatewayError(504, 'TIMEOUT', 'Operation timed out.', true)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
