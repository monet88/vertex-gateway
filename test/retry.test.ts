import { describe, expect, it, vi, afterEach } from 'vitest';
import { retryWithJitter, computeBackoffMs, DEFAULT_RETRY_BASE_DELAY_MS } from '../src/lib/retry.js';

describe('computeBackoffMs', () => {
  it('returns a value in the full jitter range [0, exponential)', () => {
    const base = 200;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const cap = Math.min(base * 2 ** attempt, 30_000);
      const value = computeBackoffMs(attempt, base);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(cap);
    }
  });

  it('caps the exponential term', () => {
    const value = computeBackoffMs(20, 250);
    expect(value).toBeLessThan(30_000);
  });

  it('bounds high attempt exponents to prevent overflow', () => {
    const value = computeBackoffMs(1000, 250);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeLessThan(30_000);
  });
});

describe('retryWithJitter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('throws AbortError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(async () => 'ok');
    await expect(
      retryWithJitter(task, 3, () => true, 10, controller.signal),
    ).rejects.toThrow('Aborted');
    expect(task).not.toHaveBeenCalled();
  });

  it('throws AbortError when signal aborts during delay', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let calls = 0;
    const task = vi.fn(async () => {
      calls += 1;
      throw new Error('503 unavailable');
    });
    const promise = retryWithJitter(task, 3, () => true, 1000, controller.signal);
    // Let first attempt fail and enter delay
    await vi.advanceTimersByTimeAsync(1);
    // Abort during delay
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(calls).toBe(1);
  });

  it('clears timeout when signal aborts during delay', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const task = vi.fn(async () => { throw new Error('503'); });
    const promise = retryWithJitter(task, 3, () => true, 5000, controller.signal);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await expect(promise).rejects.toThrow('Aborted');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
