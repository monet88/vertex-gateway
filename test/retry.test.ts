import { describe, expect, it, vi } from 'vitest';
import { retryWithJitter, computeBackoffMs, DEFAULT_RETRY_BASE_DELAY_MS } from '../src/lib/retry.js';

describe('computeBackoffMs', () => {
  it('is exponential plus full jitter bounded by base', () => {
    const base = 200;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const min = Math.min(base * 2 ** attempt, 30_000);
      const value = computeBackoffMs(attempt, base);
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(min + base);
    }
  });

  it('caps the exponential term', () => {
    const value = computeBackoffMs(20, 250);
    expect(value).toBeLessThanOrEqual(30_000 + 250);
  });
});

describe('retryWithJitter', () => {
  it('retries transient failures then succeeds and reports attempt count', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('503 unavailable');
      return 'ok';
    });
    const promise = retryWithJitter(task, 3, () => true, 10);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ value: 'ok', retries: 2 });
    expect(task).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry when retries is 0', async () => {
    const task = vi.fn(async () => { throw new Error('503 unavailable'); });
    await expect(retryWithJitter(task, 0, () => true, 10)).rejects.toThrow('503 unavailable');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not retry when shouldRetry is false', async () => {
    const task = vi.fn(async () => { throw new Error('400 bad request'); });
    await expect(retryWithJitter(task, 3, () => false, 10)).rejects.toThrow('400 bad request');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defaults base delay to the documented constant', () => {
    expect(DEFAULT_RETRY_BASE_DELAY_MS).toBe(250);
  });
});
