import type { IncomingMessage } from 'node:http';
import { GatewayError } from '../http/error-response.js';

interface LoginAttemptState {
  readonly firstFailureAt: number;
  readonly failures: number;
}

interface AdminLoginRateLimiterOptions {
  readonly now?: () => number;
  readonly windowMs: number;
  readonly maxFailures: number;
  readonly cleanupIntervalMs?: number;
}

const loginRateLimitKey = (req: Pick<IncomingMessage, 'socket'>, username: string): string =>
  `${req.socket.remoteAddress ?? 'unknown'}:${(username ?? '').trim().toLowerCase()}`;

export interface AdminLoginRateLimiter {
  assertAllowed: (req: Pick<IncomingMessage, 'socket'>, username: string) => void;
  recordFailure: (req: Pick<IncomingMessage, 'socket'>, username: string) => void;
  clearFailures: (req: Pick<IncomingMessage, 'socket'>, username: string) => void;
  size: () => number;
  dispose: () => void;
}

export const createAdminLoginRateLimiter = (
  options: AdminLoginRateLimiterOptions,
): AdminLoginRateLimiter => {
  const attempts = new Map<string, LoginAttemptState>();
  const now = options.now ?? Date.now;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60_000;

  const pruneExpired = (currentTime: number): void => {
    for (const [key, state] of attempts.entries()) {
      if (currentTime - state.firstFailureAt > options.windowMs) {
        attempts.delete(key);
      }
    }
  };

  const assertAllowed = (req: Pick<IncomingMessage, 'socket'>, username: string): void => {
    const currentTime = now();
    pruneExpired(currentTime);
    const current = attempts.get(loginRateLimitKey(req, username));
    if (!current) {
      return;
    }
    if (current.failures >= options.maxFailures) {
      throw new GatewayError(429, 'RATE_LIMITED', 'Too many failed admin login attempts. Try again later.');
    }
  };

  const recordFailure = (req: Pick<IncomingMessage, 'socket'>, username: string): void => {
    const currentTime = now();
    pruneExpired(currentTime);
    const key = loginRateLimitKey(req, username);
    const current = attempts.get(key);
    if (!current) {
      attempts.set(key, { firstFailureAt: currentTime, failures: 1 });
      return;
    }
    attempts.set(key, { firstFailureAt: current.firstFailureAt, failures: current.failures + 1 });
  };

  const clearFailures = (req: Pick<IncomingMessage, 'socket'>, username: string): void => {
    attempts.delete(loginRateLimitKey(req, username));
  };

  const cleanupTimer = cleanupIntervalMs > 0
    ? setInterval(() => {
        pruneExpired(now());
      }, cleanupIntervalMs)
    : null;
  cleanupTimer?.unref?.();

  return {
    assertAllowed,
    recordFailure,
    clearFailures,
    size: () => attempts.size,
    dispose: () => {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
      }
    },
  };
};
