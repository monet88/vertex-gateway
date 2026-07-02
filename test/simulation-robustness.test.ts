import { describe, expect, it, vi, afterEach } from 'vitest';
import { createGenAiRuntime } from '../src/lib/genai-runtime.js';
import { testConfig } from './test-config.js';
import { GatewayError } from '../src/http/error-response.js';

const poolConfigOverrides = (upstreamRetries: number, upstreamRetryDelayMs = 0) => ({
  runtimeMode: 'pool' as const,
  vertexPoolSelection: 'round-robin' as const,
  vertexPoolFailoverCooldownMs: 60000,
  upstreamRetries,
  upstreamRetryDelayMs,
});

describe('Simulation Robustness Tests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Case A: Network failure (503 Service Unavailable)
  // Verify retries on the same target and eventual failover.
  describe('Case A: Network Failure (503 Service Unavailable)', () => {
    it('retries on network failure and fails over (non-streaming)', async () => {
      const calls: string[] = [];
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2),
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(async () => {
            calls.push(target.id);
            if (target.id === 'target-a') {
              throw new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Network failure simulated', true);
            }
            return { targetId: target.id };
          }),
        },
      }));

      const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' }, { routeFamily: 'openai-chat' });

      expect(response).toEqual({ targetId: 'target-b' });
      // UPSTREAM_UNAVAILABLE → immediate failover, no per-target retries
      expect(calls).toEqual(['target-a', 'target-b']);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      const targetB = snapshot.targets.find((t) => t.id === 'target-b')!.health;

      expect(targetA.failure).toBe(1);
      expect(targetA.retries).toBe(0);
      expect(targetA.status).toBe('cooldown');
      expect(targetB.success).toBe(1);
      expect(targetB.status).toBe('healthy');
    });

    it('retries on network failure and fails over (streaming first-chunk)', async () => {
      const calls: string[] = [];
      let returnCount = 0;
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2),
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => ({
            [Symbol.asyncIterator]() {
              let yielded = false;
              return {
                next: async () => {
                  calls.push(`next:${target.id}`);
                  if (target.id === 'target-a') {
                    throw new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Network failure simulated stream', true);
                  }
                  if (yielded) return { done: true, value: undefined };
                  yielded = true;
                  return { done: false, value: { event: `chunk:${target.id}` } };
                },
                return: async () => {
                  returnCount += 1;
                  calls.push(`return:${target.id}:${returnCount}`);
                  return { done: true, value: undefined };
                },
              };
            },
          })),
        },
      }));

      const stream = await runtime.client.models.generateContentStream({ model: 'gemini-2.5-flash' }, {
        routeFamily: 'openai-responses',
        streamGuard: { idleTimeoutMs: 250, maxDurationMs: 10000 },
      });
      const events: string[] = [];
      for await (const chunk of stream) {
        events.push(String(chunk.event));
      }

      expect(events).toEqual(['chunk:target-b']);
      // UPSTREAM_UNAVAILABLE → immediate failover
      expect(calls).toEqual([
        'next:target-a', 'return:target-a:1',
        'next:target-b', 'next:target-b',
      ]);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.retries).toBe(0);
      expect(targetA.failure).toBe(1);
    });
  });

  // Case B: API timeouts (504 Timeout)
  // Verify retries/failover behavior.
  describe('Case B: API Timeouts (504 Gateway Timeout)', () => {
    it('retries on timeout and fails over (non-streaming)', async () => {
      const calls: string[] = [];
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2),
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(async () => {
            calls.push(target.id);
            if (target.id === 'target-a') {
              throw new GatewayError(504, 'TIMEOUT', 'Timeout simulated', true);
            }
            return { targetId: target.id };
          }),
        },
      }));

      const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' }, { routeFamily: 'openai-chat' });

      expect(response).toEqual({ targetId: 'target-b' });
      expect(calls).toEqual(['target-a', 'target-b']);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.failure).toBe(1);
      expect(targetA.retries).toBe(0);
      expect(targetA.status).toBe('cooldown');
    });

    it('retries on timeout and fails over (streaming first-chunk)', async () => {
      const calls: string[] = [];
      let returnCount = 0;
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2),
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => ({
            [Symbol.asyncIterator]() {
              let yielded = false;
              return {
                next: async () => {
                  calls.push(`next:${target.id}`);
                  if (target.id === 'target-a') {
                    throw new GatewayError(504, 'TIMEOUT', 'Timeout simulated stream', true);
                  }
                  if (yielded) return { done: true, value: undefined };
                  yielded = true;
                  return { done: false, value: { event: `chunk:${target.id}` } };
                },
                return: async () => {
                  returnCount += 1;
                  calls.push(`return:${target.id}:${returnCount}`);
                  return { done: true, value: undefined };
                },
              };
            },
          })),
        },
      }));

      const stream = await runtime.client.models.generateContentStream({ model: 'gemini-2.5-flash' }, {
        routeFamily: 'openai-responses',
        streamGuard: { idleTimeoutMs: 250, maxDurationMs: 10000 },
      });
      const events: string[] = [];
      for await (const chunk of stream) {
        events.push(String(chunk.event));
      }

      expect(events).toEqual(['chunk:target-b']);
      expect(calls).toEqual([
        'next:target-a', 'return:target-a:1',
        'next:target-b', 'next:target-b',
      ]);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.retries).toBe(0);
      expect(targetA.failure).toBe(1);
    });
  });

  // Case C: Quota exhaustion (429 Resource Exhausted)
  // Verify backoff retries and failover.
  describe('Case C: Quota Exhaustion (429 Resource Exhausted)', () => {
    it('retries with exponential backoff and fails over (non-streaming)', async () => {
      vi.useFakeTimers();

      // Spy on setTimeout to verify backoff values.
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      // Mock Math.random to return 0.5 deterministically so jitter calculation is fixed.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const calls: string[] = [];
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2, 100), // upstreamRetryDelayMs = 100ms
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(async () => {
            calls.push(target.id);
            if (target.id === 'target-a') {
              throw new GatewayError(429, 'UPSTREAM_QUOTA', 'Quota exceeded simulated', true);
            }
            return { targetId: target.id };
          }),
        },
      }));

      // Initiate request - it will trigger a retry and register setTimeout callbacks.
      const requestPromise = runtime.client.models.generateContent({ model: 'gemini-2.5-flash' }, { routeFamily: 'openai-chat' });

      // Run fake timers until all pending timeouts and promises resolve.
      await vi.runAllTimersAsync();

      const response = await requestPromise;

      expect(response).toEqual({ targetId: 'target-b' });
      expect(calls).toEqual(['target-a', 'target-a', 'target-a', 'target-b']);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.failure).toBe(1);
      expect(targetA.retries).toBe(2);
      expect(targetA.status).toBe('cooldown');

      // Verify that setTimeout was called with computed backoff delay values.
      // computeBackoffMs(0, 100) -> random(0, 100 * 2^0) = 50ms (random=0.5)
      // computeBackoffMs(1, 100) -> random(0, 100 * 2^1) = 100ms (random=0.5)
      const timeouts = setTimeoutSpy.mock.calls.map((c) => c[1]);
      expect(timeouts).toContain(50);
      expect(timeouts).toContain(100);
    });

    it('retries with exponential backoff and fails over (streaming first-chunk)', async () => {
      vi.useFakeTimers();

      // Spy on setTimeout to verify backoff values.
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      // Mock Math.random to return 0.5 deterministically so jitter calculation is fixed.
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const calls: string[] = [];
      let returnCount = 0;
      const runtime = createGenAiRuntime(testConfig({
        ...poolConfigOverrides(2, 100), // upstreamRetryDelayMs = 100ms
        vertexPools: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        ],
        resolvedVertexTargets: [
          { id: 'target-a', project: 'proj-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
          { id: 'target-b', project: 'proj-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        ],
      }), (_config, target) => ({
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => ({
            [Symbol.asyncIterator]() {
              let yielded = false;
              return {
                next: async () => {
                  calls.push(`next:${target.id}`);
                  if (target.id === 'target-a') {
                    throw new GatewayError(429, 'UPSTREAM_QUOTA', 'Quota exceeded simulated stream', true);
                  }
                  if (yielded) return { done: true, value: undefined };
                  yielded = true;
                  return { done: false, value: { event: `chunk:${target.id}` } };
                },
                return: async () => {
                  returnCount += 1;
                  calls.push(`return:${target.id}:${returnCount}`);
                  return { done: true, value: undefined };
                },
              };
            },
          })),
        },
      }));

      // Initiate request - it will trigger a retry and register setTimeout callbacks.
      const requestPromise = runtime.client.models.generateContentStream({ model: 'gemini-2.5-flash' }, {
        routeFamily: 'openai-responses',
        streamGuard: { idleTimeoutMs: 250, maxDurationMs: 10000 },
      });

      // Run fake timers until all pending timeouts and promises resolve.
      await vi.runAllTimersAsync();

      const stream = await requestPromise;
      const events: string[] = [];
      for await (const chunk of stream) {
        events.push(String(chunk.event));
      }

      expect(events).toEqual(['chunk:target-b']);
      expect(calls).toEqual([
        'next:target-a', 'return:target-a:1',
        'next:target-a', 'return:target-a:2',
        'next:target-a', 'return:target-a:3',
        'next:target-b', 'next:target-b',
      ]);

      const snapshot = runtime.getSnapshot().active;
      const targetA = snapshot.targets.find((t) => t.id === 'target-a')!.health;
      expect(targetA.retries).toBe(2);
      expect(targetA.failure).toBe(1);

      // Verify timeouts of 50ms and 100ms
      const timeouts = setTimeoutSpy.mock.calls.map((c) => c[1]);
      expect(timeouts).toContain(50);
      expect(timeouts).toContain(100);
    });
  });
});
