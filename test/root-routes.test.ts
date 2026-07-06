import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { GenAiRuntimeLike } from '../src/lib/genai-runtime.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const createFakeRuntime = (): GenAiRuntimeLike => ({
  client: { models: { generateContent: vi.fn(async () => ({})) } },
  getSnapshot: () => ({
    mode: 'pool',
    active: {
      version: 1,
      selection: 'round-robin',
      targetCount: 1,
      healthyTargets: 1,
      cooldownTargets: 0,
      targets: [{
        id: 'project-a',
        project: 'project-a',
        location: 'global',
        weight: 1,
        health: {
          status: 'healthy',
          success: 0,
          failure: 0,
          recent: [],
          routeFamilyBuckets: {
            gemini: { success: 0, failure: 0 },
            vertex: { success: 0, failure: 0 },
            'openai-chat': { success: 0, failure: 0 },
            'openai-responses': { success: 0, failure: 0 },
            images: { success: 0, failure: 0 },
            unknown: { success: 0, failure: 0 },
          },
        },
      }],
    },
  }),
  reload: vi.fn((nextConfig) => ({
    mode: nextConfig?.runtimeMode ?? 'pool',
    active: {
      version: 2,
      selection: nextConfig?.vertexPoolSelection ?? 'round-robin',
      targetCount: nextConfig?.resolvedVertexTargets.length ?? 0,
      healthyTargets: nextConfig?.resolvedVertexTargets.length ?? 0,
      cooldownTargets: 0,
      targets: [],
    },
  })),
  probeTarget: vi.fn(async () => ({ ok: true })),
});

describe('root route', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it('returns public gateway endpoint metadata', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe('Chang Store Vertex Gateway');
    expect(body.endpoints).toEqual(expect.arrayContaining([
      'GET /gemini/v1beta/models',
      'POST /gemini/v1beta/models/{model}:generateContent',
      'POST /openai/v1/chat/completions',
      'POST /openai/v1/responses',
      'POST /openai/v1/images/generations',
      'POST /openai/v1/images/edits',
    ]));
    expect(body.endpoints).not.toEqual(expect.arrayContaining([
      expect.stringContaining('/vertex/'),
      expect.stringContaining('/vtx/'),
      expect.stringContaining('/api/images/'),
    ]));
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('renders developer docs at /docs without requiring auth', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/docs`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Vertex Gateway Docs');
    expect(body).toContain('/openai/v1/chat/completions');
    expect(body).toContain('/gemini/v1beta/models/{model}:generateContent');
    expect(body).toContain('YOUR_GATEWAY_KEY');
    expect(body).toContain('gemini-2.5-flash-image');
    expect(body).toContain('javascript streaming example');
    expect(body).toContain('data-copy=');
    expect(body).toContain('Copy');
    expect(body).not.toContain('/vertex/v1/projects');
    expect(body).not.toContain('/vtx/v1');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('renders llms.txt without requiring auth', async () => {
    const generateContent = vi.fn();
    server = createApp({ config: testConfig(), genAiFactory: () => ({ models: { generateContent } }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/llms.txt`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(body).toContain('# Vertex Gateway');
    expect(body).toContain('/docs');
    expect(body).toContain('/openai/v1/chat/completions');
    expect(body).toContain('Authorization: Bearer YOUR_GATEWAY_KEY');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns readiness summary for pool mode without touching the model client', async () => {
    const generateContent = vi.fn();
    server = createApp({
      config: testConfig({
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
            location: 'us-central1',
            credentialsFile: null,
            enabled: false,
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
        ],
      }),
      genAiFactory: () => ({ models: { generateContent } }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/readyz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.google).toEqual({
      mode: 'pool',
      apiVersion: 'v1',
      selection: 'round-robin',
      configuredTargets: 2,
      enabledTargets: 1,
      credentialFileTargets: 0,
      apiKeyTargets: 0,
    });
    expect(body.runtime).toEqual({
      mode: 'pool',
      selection: 'round-robin',
      configuredTargets: 2,
      enabledTargets: 1,
      healthyTargets: 1,
      cooldownTargets: 0,
    });
    expect(body.limits.upstreamRetries).toBe(2);
    expect(body.limits.upstreamRetryDelayMs).toBe(250);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('returns detailed pool health only through the admin bearer route', async () => {
    const generateContent = vi.fn();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
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
      }),
      genAiFactory: () => ({ models: { generateContent } }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const unauthorized = await fetch(`${baseUrl}/admin/api/health/pool`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/admin/api/health/pool`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const body = await authorized.json();

    expect(authorized.status).toBe(200);
    expect(body.runtime.active.targets).toEqual([
      expect.objectContaining({
        id: 'project-a',
        project: 'project-a',
        location: 'global',
        health: expect.objectContaining({
          status: 'healthy',
          success: 0,
          failure: 0,
        }),
      }),
    ]);
  });
});
