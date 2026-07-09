import { describe, expect, it, vi } from 'vitest';
import { createGenAiPoolSnapshot, selectGenAiTarget } from '../src/lib/genai-pool.js';
import { createGenAiRuntime } from '../src/lib/genai-runtime.js';
import type { GenAiTargetClientFactory } from '../src/lib/google-genai-client.js';
import { ImageWorkloads } from '../src/workloads/image-workloads.js';
import { testConfig } from './test-config.js';

const poolConfigOverrides = (upstreamRetries: number) => ({
  runtimeMode: 'pool' as const,
  vertexPoolSelection: 'round-robin' as const,
  vertexPoolFailoverCooldownMs: 60000,
  upstreamRetries,
  upstreamRetryDelayMs: 0,
});

const createFactory = (calls: string[], streamEvents?: string[]): GenAiTargetClientFactory => (
  _config,
  target,
) => ({
  models: {
    generateContent: vi.fn(async () => {
      calls.push(target.id);
      return { targetId: target.id };
    }),
    generateContentStream: vi.fn(async () => ({
      async *[Symbol.asyncIterator]() {
        calls.push(`stream:${target.id}`);
        if (streamEvents) {
          for (const event of streamEvents) {
            yield { targetId: target.id, event };
          }
        }
      },
    })),
  },
});

describe('GenAI runtime pool', () => {
  it('retries the same target before failing over (non-streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(2),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') throw new Error('429 quota exceeded');
          return { targetId: target.id };
        }),
      },
    }));

    const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' }, { routeFamily: 'openai-chat' });

    expect(response).toEqual({ targetId: 'project-b' });
    // project-a attempted 1 + 2 retries = 3 times, then failover to project-b once.
    expect(calls).toEqual(['project-a', 'project-a', 'project-a', 'project-b']);
    const snapshot = runtime.getSnapshot().active;
    const a = snapshot.targets.find((t) => t.id === 'project-a')!.health;
    expect(a.failure).toBe(1);
    expect(a.retries).toBe(2);
    expect(a.status).toBe('cooldown');
  });

  it('recovers on the second attempt without failover or cooldown (non-streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(2),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => {
      let attempt = 0;
      return {
        models: {
          generateContent: vi.fn(async () => {
            attempt += 1;
            calls.push(`${target.id}:${attempt}`);
            if (attempt === 1) throw new Error('429 quota exceeded');
            return { targetId: target.id };
          }),
        },
      };
    });

    const response = await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(response).toEqual({ targetId: 'project-a' });
    expect(calls).toEqual(['project-a:1', 'project-a:2']);
    const a = runtime.getSnapshot().active.targets[0].health;
    expect(a.success).toBe(1);
    expect(a.failure).toBe(0);
    expect(a.retries).toBe(1);
    expect(a.status).toBe('healthy');
  });

  it('does not add retries when upstreamRetries is 0', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(0),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') throw new Error('429 quota exceeded');
          return { targetId: target.id };
        }),
      },
    }));

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    expect(calls).toEqual(['project-a', 'project-b']);
    expect(runtime.getSnapshot().active.targets.find((t) => t.id === 'project-a')!.health.retries).toBe(0);
  });

  it('retries the same target on first-chunk failure before failover (streaming)', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(1),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => {
      let returnCount = 0;
      return {
        models: {
          generateContent: vi.fn(),
          generateContentStream: vi.fn(async () => ({
            [Symbol.asyncIterator]() {
              let yielded = false;
              return {
                next: async () => {
                  calls.push(`next:${target.id}`);
                  if (target.id === 'project-a') throw new Error('429 quota exceeded');
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
      };
    });

    const stream = await runtime.client.models.generateContentStream?.({ model: 'gemini-2.5-flash' }, {
      routeFamily: 'openai-responses',
      streamGuard: { idleTimeoutMs: 250, maxDurationMs: 10000 },
    });
    const events: string[] = [];
    for await (const chunk of stream ?? []) events.push(String(chunk.event));

    expect(events).toEqual(['chunk:project-b']);
    // project-a: attempt 1 (next+return), retry attempt 2 (next+return), then failover.
    expect(calls).toEqual([
      'next:project-a', 'return:project-a:1',
      'next:project-a', 'return:project-a:2',
      'next:project-b', 'next:project-b',
    ]);
    const a = runtime.getSnapshot().active.targets.find((t) => t.id === 'project-a')!.health;
    expect(a.retries).toBe(1);
    expect(a.failure).toBe(1);
  });
  it('rotates across targets with round-robin selection', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-c',
          project: 'project-c',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project C',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-c',
          project: 'project-c',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project C',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), createFactory(calls));

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(calls).toEqual(['project-a', 'project-b', 'project-c']);
  });

  it('keeps using the first healthy target with bind-first selection', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'bind-first',
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 3, label: 'Project A', modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, label: 'Project B', modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 3, label: 'Project A', modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, label: 'Project B', modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), createFactory(calls));

    for (let index = 0; index < 4; index += 1) {
      await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    }

    expect(calls).toEqual(['project-a', 'project-a', 'project-a', 'project-a']);
  });

  it('fails over to the next target when the first bind-first target fails', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'bind-first',
      vertexPoolFailoverCooldownMs: 60_000,
      upstreamRetries: 0,
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 3, label: 'Project A', modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, label: 'Project B', modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 3, label: 'Project A', modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, label: 'Project B', modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') throw new Error('503 unavailable');
          return { targetId: target.id };
        }),
      },
    }));

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(calls).toEqual(['project-a', 'project-b', 'project-b']);
  });

  it('starts with no targets and returns a 503 until credentials are added', async () => {
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPools: [],
      resolvedVertexTargets: [],
    }), createFactory([]));

    expect(runtime.getSnapshot().active.targetCount).toBe(0);
    await expect(runtime.client.models.generateContent({ model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });

  it('keeps a stable proxy across reload and sends future traffic to new targets', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), createFactory(calls));

    const stableClient = runtime.client;
    await stableClient.models.generateContent({ model: 'gemini-2.5-flash' });
    runtime.reload(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }));
    await stableClient.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(calls).toEqual(['project-a', 'project-b']);
  });

  it('keeps the previous snapshot active when reload build fails', async () => {
    const calls: string[] = [];
    const factory: GenAiTargetClientFactory = (_config, target) => {
      if (target.id === 'project-b') {
        throw new Error('bad target');
      }
      return {
        models: {
          generateContent: vi.fn(async () => {
            calls.push(target.id);
            return { targetId: target.id };
          }),
        },
      };
    };
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), factory);

    expect(() => runtime.reload(testConfig({
      runtimeMode: 'pool',
      vertexPools: [
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }))).toThrow(/bad target/);

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    expect(calls).toEqual(['project-a']);
  });

  it('pins the snapshot until a streaming iterator completes', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), createFactory(calls, ['chunk-1', 'chunk-2']));

    const stream = await runtime.client.models.generateContentStream?.({ model: 'gemini-2.5-flash' });
    expect(runtime.getSnapshot().active.targetCount).toBe(1);
    const activeSnapshot = (runtime as unknown as { activeSnapshot: { refCount: number } }).activeSnapshot;

    expect(activeSnapshot.refCount).toBe(1);
    const chunks: string[] = [];
    for await (const chunk of stream ?? []) {
      chunks.push(String(chunk.event));
    }
    expect(chunks).toEqual(['chunk-1', 'chunk-2']);
    expect(activeSnapshot.refCount).toBe(0);
    expect(calls).toEqual(['stream:project-a']);
  });

  it('routes custom image workloads through the same pool seam', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: 'ZmFrZQ==',
                      },
                    },
                  ],
                },
              },
            ],
          };
        }),
      },
    }));
    const workloads = new ImageWorkloads(runtime.client, testConfig());

    const response = await workloads.generate({
      prompt: 'Generate outfit',
      model: 'gemini-3.1-flash-image',
      numberOfImages: 2,
    });

    expect(response.images).toHaveLength(2);
    expect(calls).toEqual(['project-a', 'project-b']);
  });

  it('fails over non-streaming requests and cools down the failing target', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      upstreamRetries: 0,
      vertexPoolSelection: 'round-robin',
      vertexPoolFailoverCooldownMs: 60000,
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          if (target.id === 'project-a') {
            throw new Error('429 quota exceeded');
          }
          return { targetId: target.id };
        }),
      },
    }));

    const response = await runtime.client.models.generateContent({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'openai-chat',
    });

    expect(response).toEqual({ targetId: 'project-b' });
    expect(calls).toEqual(['project-a', 'project-b']);
    expect(runtime.getSnapshot().active.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'project-a',
        health: expect.objectContaining({
          status: 'cooldown',
          failure: 1,
          routeFamilyBuckets: expect.objectContaining({
            'openai-chat': { success: 0, failure: 1 },
          }),
        }),
      }),
      expect.objectContaining({
        id: 'project-b',
        health: expect.objectContaining({
          status: 'healthy',
          success: 1,
        }),
      }),
    ]));
  });

  it('clears a target cooldown immediately after a successful fallback request', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPoolFailoverCooldownMs: 60000,
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), createFactory(calls));

    const activeSnapshot = (runtime as unknown as {
      activeSnapshot: { targets: Array<{ health: { status: string; cooldownUntil?: number } }> };
    }).activeSnapshot;
    const target = activeSnapshot.targets[0];
    target.health.status = 'cooldown';
    target.health.cooldownUntil = Date.now() + 60_000;

    await runtime.client.models.generateContent({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'openai-chat',
    });

    expect(calls).toEqual(['project-a']);
    expect(target.health.status).toBe('healthy');
    expect(target.health.cooldownUntil).toBeUndefined();
  });

  it('honors per-target model allowlists and exclusions during selection', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: ['gemini-2.5-flash'],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: ['gemini-2.5-flash'],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: ['gemini-2.5-flash'],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: ['gemini-2.5-flash'],
          source: 'pool',
        },
      ],
    }), createFactory(calls));

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    expect(calls).toEqual(['project-a']);
  });

  it('does not retry malformed requests across targets', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          throw new Error('400 validation failed');
        }),
      },
    }));

    await expect(runtime.client.models.generateContent({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'gemini',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toEqual(['project-a']);
  });

  it('fails over streaming when the first iterator.next rejects before any chunk is yielded', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      upstreamRetries: 0,
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
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
                if (target.id === 'project-a') {
                  throw new Error('timeout waiting for first chunk');
                }
                if (yielded) {
                  return { done: true, value: undefined };
                }
                yielded = true;
                return { done: false, value: { event: `chunk:${target.id}` } };
              },
              return: async () => ({ done: true, value: undefined }),
            };
          },
        })),
      },
    }));

    const stream = await runtime.client.models.generateContentStream?.({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'openai-responses',
      streamGuard: {
        idleTimeoutMs: 250,
        maxDurationMs: 10000,
      },
    });

    const events: string[] = [];
    for await (const chunk of stream ?? []) {
      events.push(String(chunk.event));
    }

    expect(events).toEqual(['chunk:project-b']);
    expect(calls).toEqual(['next:project-a', 'next:project-b', 'next:project-b']);
  });

  it('does not switch targets after the first streaming chunk has been yielded', async () => {
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(),
        generateContentStream: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield { event: `chunk:${target.id}` };
            if (target.id === 'project-a') {
              throw new Error('upstream disconnected');
            }
          },
        })),
      },
    }));

    const stream = await runtime.client.models.generateContentStream?.({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'openai-chat',
      streamGuard: {
        idleTimeoutMs: 250,
        maxDurationMs: 10000,
      },
    });

    const iterator = stream?.[Symbol.asyncIterator]();
    expect(await iterator?.next()).toEqual({ done: false, value: { event: 'chunk:project-a' } });
    await expect(iterator?.next()).rejects.toThrow(/upstream disconnected/);
    const snapshot = runtime.getSnapshot().active;
    expect(snapshot.targets.find((target) => target.id === 'project-b')?.health.success).toBe(0);
  });

  it('falls back to the shortest-cooldown target when every target is cooling down', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }), createFactory([]));
    const activeSnapshot = (runtime as unknown as { activeSnapshot: { targets: Array<{ id: string; health: { cooldownUntil?: number; status: string } }> } }).activeSnapshot;
    const now = Date.now();
    activeSnapshot.targets[0].health.status = 'cooldown';
    activeSnapshot.targets[0].health.cooldownUntil = now + 5000;
    activeSnapshot.targets[1].health.status = 'cooldown';
    activeSnapshot.targets[1].health.cooldownUntil = now + 1000;

    await runtime.client.models.generateContent({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'gemini',
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('retries transient image edit failures before surfacing an error', async () => {
    let attempts = 0;
    const workloads = new ImageWorkloads({
      models: {
        generateContent: vi.fn(async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('429 resource_exhausted');
          }
          return {
            candidates: [
              {
                finishReason: 'STOP',
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: 'ZmFrZQ==',
                      },
                    },
                  ],
                },
              },
            ],
          };
        }),
      },
    }, testConfig());

    const response = await workloads.edit({
      prompt: 'Retry this edit',
      model: 'gemini-3.1-flash-image',
      numberOfImages: 1,
      images: [
        {
          mimeType: 'image/jpeg',
          data: 'ZmFrZQ==',
        },
      ],
    });

    expect(attempts).toBe(2);
    expect(response.images).toHaveLength(1);
    expect(response.images[0]?.mimeType).toBe('image/png');
  });

  it('propagates the real upstream lastError instead of model-exclusion errors if failover fails after an attempt', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      ...poolConfigOverrides(0),
      vertexPools: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: ['different-model-only'], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'project-a', project: 'project-a', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'project-b', project: 'project-b', location: 'global', credentialsFile: null, enabled: true, weight: 1, modelAllowlist: ['different-model-only'], modelExclusions: [], source: 'pool' },
      ],
    }), (_config, target) => ({
      models: {
        generateContent: vi.fn(async () => {
          calls.push(target.id);
          throw new Error('429 resource_exhausted');
        }),
      },
    }));

    await expect(runtime.client.models.generateContent({
      model: 'gemini-2.5-flash',
    }, {
      routeFamily: 'gemini',
    })).rejects.toThrow('Upstream quota exhausted.');

    expect(calls).toEqual(['project-a']);
  });

  it('RR select uses candidate membership without changing order', () => {
    const config = testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        { id: 'a', project: 'a', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'b', project: 'b', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
        { id: 'c', project: 'c', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [] },
      ],
      resolvedVertexTargets: [
        { id: 'a', project: 'a', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'b', project: 'b', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
        { id: 'c', project: 'c', location: 'global', credentialsFile: null, apiKey: null, apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool' },
      ],
    });
    const snapshot = createGenAiPoolSnapshot(config, () => ({ models: { generateContent: async () => ({}) } }), 1);
    snapshot.nextIndex = 0;
    expect(Array.from({ length: 6 }, () => selectGenAiTarget(snapshot).id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c']);
  });
});
