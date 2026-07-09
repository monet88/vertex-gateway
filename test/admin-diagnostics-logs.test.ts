import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashAdminPassword } from '../src/admin/admin-password.js';
import type { GenAiRuntimeLike } from '../src/lib/genai-runtime.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const seedAdmin = async (storeDir: string) => {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'admin-settings.json'), JSON.stringify({
    adminUsername: 'admin',
    adminPasswordHash: await hashAdminPassword('changed-admin-password'),
    adminPasswordChangedAt: new Date(0).toISOString(),
  }));
};

const login = async (baseUrl: string) => {
  const res = await fetch(`${baseUrl}/admin/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'changed-admin-password' }),
  });
  const body = await res.json() as { token: string };
  return body.token;
};

const fakeRuntime = (): GenAiRuntimeLike => ({
  client: { models: { generateContent: vi.fn(async () => ({})) } },
  getSnapshot: () => ({
    mode: 'pool',
    active: {
      version: 1,
      selection: 'round-robin',
      targetCount: 0,
      healthyTargets: 0,
      cooldownTargets: 0,
      targets: [],
    },
  }),
  reload: vi.fn(),
});

describe('admin diagnostics and logs routes', () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GET diagnostics, PATCH gate on, list/clear logs', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-admin-diag-'));
    dirs.push(storeDir);
    await seedAdmin(storeDir);
    const generateContent = vi.fn(async () => ({
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    }));
    const server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminStoreMode: 'file-store',
        adminAllowMutations: true,
        adminFileStoreDir: storeDir,
        adminToken: null,
        gatewayKeys: ['test-key'],
      }),
      genAiFactory: () => ({ models: { generateContent } }),
      runtimeFactory: () => fakeRuntime(),
    });
    servers.push(server);
    const baseUrl = await listen(server);
    const token = await login(baseUrl);

    const diag1 = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(diag1.status).toBe(200);
    const d1 = await diag1.json() as { debugMode: boolean; logToFile: boolean; gateEnabled: boolean; writable: boolean };
    expect(d1).toMatchObject({ debugMode: false, logToFile: false, gateEnabled: false, writable: true });

    const logsOff = await fetch(`${baseUrl}/admin/api/logs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logsOff.status).toBe(409);

    const patch = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ debugMode: true, logToFile: true }),
    });
    expect(patch.status).toBe(200);
    const d2 = await patch.json() as { gateEnabled: boolean };
    expect(d2.gateEnabled).toBe(true);

    const modelsRes = await fetch(`${baseUrl}/openai/v1/models`, {
      headers: { authorization: 'Bearer test-key' },
    });
    expect(modelsRes.status).toBeLessThan(500);

    const logsOn = await fetch(`${baseUrl}/admin/api/logs?limit=10`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logsOn.status).toBe(200);
    const listed = await logsOn.json() as { entries: Array<{ routeFamily: string; path: string }> };
    expect(listed.entries.length).toBeGreaterThan(0);
    expect(listed.entries[0]?.routeFamily).toBe('openai');

    const cleared = await fetch(`${baseUrl}/admin/api/logs`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cleared.status).toBe(200);
    const logsEmpty = await fetch(`${baseUrl}/admin/api/logs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const emptyBody = await logsEmpty.json() as { entries: unknown[] };
    expect(emptyBody.entries).toEqual([]);
  });

  it('rejects diagnostics patch when static-config', async () => {
    const server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminStoreMode: 'static-config',
        adminAllowMutations: false,
        adminFileStoreDir: null,
        adminToken: 'static-admin-token-value',
      }),
      runtimeFactory: () => fakeRuntime(),
    });
    servers.push(server);
    const baseUrl = await listen(server);
    const res = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer static-admin-token-value',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ debugMode: true, logToFile: true }),
    });
    expect(res.status).toBe(409);
  });
});
