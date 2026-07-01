import { describe, expect, it, vi } from 'vitest';
import { createGenAiRuntime } from '../src/lib/genai-runtime.js';
import type { GenAiTargetClientFactory } from '../src/lib/google-genai-client.js';
import { ImageWorkloads } from '../src/workloads/image-workloads.js';
import { testConfig } from './test-config.js';

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

  it('uses weighted round-robin for uneven target weights', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'weighted-round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 3,
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
          weight: 3,
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
    }), createFactory(calls));

    for (let index = 0; index < 8; index += 1) {
      await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    }

    expect(calls.filter((id) => id === 'project-a')).toHaveLength(6);
    expect(calls.filter((id) => id === 'project-b')).toHaveLength(2);
  });

  it('uses only active candidate weights when one target is cooling down', async () => {
    const calls: string[] = [];
    const runtime = createGenAiRuntime(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'weighted-round-robin',
      vertexPoolFailoverCooldownMs: 60_000,
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: null,
          enabled: true,
          weight: 3,
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
          weight: 3,
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
    }), createFactory(calls));

    const snapshot = runtime.getSnapshot().active;
    snapshot.targets.find((target) => target.id === 'project-b')!.health.cooldownUntil = Date.now() + 60_000;
    snapshot.targets.find((target) => target.id === 'project-b')!.health.status = 'cooldown';

    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });

    snapshot.targets.find((target) => target.id === 'project-b')!.health.cooldownUntil = undefined;
    snapshot.targets.find((target) => target.id === 'project-b')!.health.status = 'healthy';

    for (let index = 0; index < 4; index += 1) {
      await runtime.client.models.generateContent({ model: 'gemini-2.5-flash' });
    }

    expect(calls).toEqual(['project-a', 'project-a', 'project-b', 'project-a', 'project-a', 'project-a']);
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
      __gatewayRouteFamily: 'openai-chat',
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
      __gatewayRouteFamily: 'openai-chat',
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
      __gatewayRouteFamily: 'gemini',
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toEqual(['project-a']);
  });

  it('fails over streaming when the first iterator.next rejects before any chunk is yielded', async () => {
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
      __gatewayRouteFamily: 'openai-responses',
      __gatewayStreamGuard: {
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
      __gatewayRouteFamily: 'openai-chat',
      __gatewayStreamGuard: {
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
      __gatewayRouteFamily: 'vertex',
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
});
