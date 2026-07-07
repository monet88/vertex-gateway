import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashGatewayKey } from '../src/admin/gateway-key-store.js';
import { hashAdminPassword } from '../src/admin/admin-password.js';
import type { GenAiRuntimeLike } from '../src/lib/genai-runtime.js';
import type { GenAiTargetHealth } from '../src/lib/genai-pool.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const seedChangedAdminPassword = async (storeDir: string): Promise<void> => {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'admin-settings.json'), JSON.stringify({
    adminUsername: 'admin',
    adminPasswordHash: await hashAdminPassword('changed-admin-password'),
    adminPasswordChangedAt: new Date(0).toISOString(),
  }));
};

const createFakeRuntime = (): GenAiRuntimeLike => {
  const emptyHealth = (): GenAiTargetHealth => ({
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
  });
  let snapshot = {
    mode: 'pool' as const,
    active: {
      version: 1,
      selection: 'round-robin' as const,
      targetCount: 0,
      healthyTargets: 0,
      cooldownTargets: 0,
      targets: [] as Array<{
        id: string;
        project: string;
        location: string;
        weight: number;
        health: GenAiTargetHealth;
      }>,
    },
  };
  return {
    client: { models: { generateContent: vi.fn(async () => ({})) } },
    getSnapshot: () => snapshot,
    reload: vi.fn((nextConfig) => {
      snapshot = {
        mode: nextConfig?.runtimeMode ?? 'pool',
        active: {
          version: snapshot.active.version + 1,
          selection: nextConfig?.vertexPoolSelection ?? 'round-robin',
          targetCount: nextConfig?.resolvedVertexTargets.length ?? 0,
          healthyTargets: nextConfig?.resolvedVertexTargets.length ?? 0,
          cooldownTargets: 0,
          targets: (nextConfig?.resolvedVertexTargets ?? []).map((target) => ({
            id: target.id,
            project: target.project,
            location: target.location,
            weight: target.weight,
            health: emptyHealth(),
          })),
        },
      };
      return snapshot;
    }),
    probeTarget: vi.fn(async (target) => ({ targetId: target.id, ok: true })),
  };
};

describe('admin routes', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it('serves the admin dashboard even when a stale config disables admin routes', async () => {
    server = createApp({ config: testConfig({ enableAdminRoutes: false }) });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin`);
    expect(response.status).toBe(200);
  });

  it('does not apply public CORS headers to admin routes', async () => {
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        corsOrigins: ['https://example.test'],
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: 'Bearer admin-secret', origin: 'https://example.test' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('bootstraps the first admin token in file-store mode', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-store-'));
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: null,
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: storeDir,
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const unauthenticatedHealth = await fetch(`${baseUrl}/admin/api/health`);
    expect(unauthenticatedHealth.status).toBe(401);

    const bootstrap = await fetch(`${baseUrl}/admin/api/bootstrap/admin-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminToken: 'new-admin-password' }),
    });
    expect(bootstrap.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(storeDir, 'admin-settings.json'), 'utf8')).adminToken).toBe('new-admin-password');

    const authenticatedHealth = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: 'Bearer new-admin-password' },
    });
    expect(authenticatedHealth.status).toBe(403);

    const changedPassword = await fetch(`${baseUrl}/admin/api/auth/change-password`, {
      method: 'POST',
      headers: { authorization: 'Bearer new-admin-password', 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'changeme', newPassword: 'changed-admin-password' }),
    });
    expect(changedPassword.status).toBe(200);

    const healthAfterPasswordChange = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: 'Bearer new-admin-password' },
    });
    expect(healthAfterPasswordChange.status).toBe(200);

    const secondBootstrap = await fetch(`${baseUrl}/admin/api/bootstrap/admin-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminToken: 'another-admin-password' }),
    });
    expect(secondBootstrap.status).toBe(409);
  });

  it('logs in with the default admin account and forces a password change', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-store-'));
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: null,
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: storeDir,
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const login = await fetch(`${baseUrl}/admin/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginBody = await login.json();
    expect(login.status).toBe(200);
    expect(loginBody.username).toBe('admin');
    expect(loginBody.token).toMatch(/^adm_/);
    expect(loginBody.mustChangePassword).toBe(true);

    const settingsBeforeChange = JSON.parse(fs.readFileSync(path.join(storeDir, 'admin-settings.json'), 'utf8'));
    expect(settingsBeforeChange.adminSessionToken).toBe(loginBody.token);
    expect(settingsBeforeChange.adminToken).toBeUndefined();
    expect(settingsBeforeChange.adminPasswordHash).toBeUndefined();

    const blockedHealth = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(blockedHealth.status).toBe(403);

    const weakChange = await fetch(`${baseUrl}/admin/api/auth/change-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'changeme', newPassword: 'changeme' }),
    });
    expect(weakChange.status).toBe(400);

    const changed = await fetch(`${baseUrl}/admin/api/auth/change-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'changeme', newPassword: 'changed-admin-password' }),
    });
    const changedBody = await changed.json();
    expect(changed.status).toBe(200);
    expect(changedBody.token).toMatch(/^adm_/);
    expect(changedBody.token).not.toBe(loginBody.token);

    const settingsAfterChange = JSON.parse(fs.readFileSync(path.join(storeDir, 'admin-settings.json'), 'utf8'));
    expect(settingsAfterChange.adminUsername).toBe('admin');
    expect(settingsAfterChange.adminSessionToken).toBe(changedBody.token);
    expect(settingsAfterChange.adminPasswordHash).toMatch(/^scrypt:v1:/);
    expect(JSON.stringify(settingsAfterChange)).not.toContain('changed-admin-password');
    expect(JSON.stringify(settingsAfterChange)).not.toContain('changeme');

    const oldTokenHealth = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(oldTokenHealth.status).toBe(401);

    const oldPassword = await fetch(`${baseUrl}/admin/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await fetch(`${baseUrl}/admin/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changed-admin-password' }),
    });
    const newPasswordBody = await newPassword.json();
    expect(newPassword.status).toBe(200);
    expect(newPasswordBody.mustChangePassword).toBe(false);
    expect(newPasswordBody.token).toBe(changedBody.token);

    const health = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: `Bearer ${changedBody.token}` },
    });
    expect(health.status).toBe(200);
  });

  it('requires changing the default password before using a configured admin token', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-store-'));
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'configured-admin-token',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: storeDir,
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const blockedHealth = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: 'Bearer configured-admin-token' },
    });
    expect(blockedHealth.status).toBe(403);

    const login = await fetch(`${baseUrl}/admin/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'changeme' }),
    });
    const loginBody = await login.json();
    expect(login.status).toBe(200);
    expect(loginBody.token).toBe('configured-admin-token');
    expect(loginBody.mustChangePassword).toBe(true);

    const changed = await fetch(`${baseUrl}/admin/api/auth/change-password`, {
      method: 'POST',
      headers: { authorization: 'Bearer configured-admin-token', 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'changeme', newPassword: 'changed-admin-password' }),
    });
    const changedBody = await changed.json();
    expect(changed.status).toBe(200);
    expect(changedBody.token).toBe('configured-admin-token');

    const health = await fetch(`${baseUrl}/admin/api/health`, {
      headers: { authorization: 'Bearer configured-admin-token' },
    });
    expect(health.status).toBe(200);
  });

  it('rejects admin token bootstrap when it overlaps a managed gateway key', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-store-'));
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: null,
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: storeDir,
        managedGatewayKeyHashes: [hashGatewayKey('managed-overlap-token')],
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const bootstrap = await fetch(`${baseUrl}/admin/api/bootstrap/admin-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adminToken: 'managed-overlap-token' }),
    });
    const body = await bootstrap.json();

    expect(bootstrap.status).toBe(400);
    expect(body.error.message).toMatch(/managed gateway keys/i);
    expect(fs.existsSync(path.join(storeDir, 'admin-settings.json'))).toBe(false);
  });

  it('accepts trailing slashes on admin API routes', async () => {
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin/api/health/`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('never exposes raw express-mode apiKey in credential listings', async () => {
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        runtimeMode: 'pool',
        vertexPools: [{
          id: 'express-target',
          label: 'Express target',
          project: 'test-project',
          location: 'us-central1',
          credentialsFile: null,
          apiKey: 'super-secret-google-api-key',
          enabled: true,
          weight: 1,
          modelAllowlist: [],
          modelExclusions: [],
        }],
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin/api/vertex-credentials`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    const entry = body.vertexPools.find((item: { id: string }) => item.id === 'express-target');
    expect(entry).toBeDefined();
    expect(entry.apiKey).toBeUndefined();
    expect(entry.hasApiKey).toBe(true);
    // Guard against the raw key leaking anywhere in the serialized response.
    expect(JSON.stringify(body)).not.toContain('super-secret-google-api-key');
  });

  it('serves the admin shell on /admin/ with a trailing slash', async () => {
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Gateway Admin');
  });

  it('supports file-store import, list, detail, patch, test, model update, reload, and delete', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = {
      authorization: 'Bearer admin-secret',
      'content-type': 'application/json',
    };

    const imported = await fetch(`${baseUrl}/admin/api/vertex-credentials/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'project-a',
        location: 'global',
        label: 'Project A',
        credential: {
          type: 'service_account',
          project_id: 'project-a',
          client_email: 'svc@example.test',
          private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        },
      }),
    });
    const importedBody = await imported.json();

    expect(imported.status).toBe(200);
    expect(importedBody.credential.private_key).toBeUndefined();
    expect(importedBody.credential.email).toBe('svc@example.test');
    expect(importedBody.credential.apiKeyMode).toBe('full');

    const list = await fetch(`${baseUrl}/admin/api/vertex-credentials`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(listBody.vertexPools).toHaveLength(1);
    const id = listBody.vertexPools[0].id as string;

    const detail = await fetch(`${baseUrl}/admin/api/vertex-credentials/${id}`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    expect(detail.status).toBe(200);

    const download = await fetch(`${baseUrl}/admin/api/vertex-credentials/${id}/download`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    expect(download.status).toBe(404);

    const patch = await fetch(`${baseUrl}/admin/api/vertex-credentials/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ label: 'Updated Project A', weight: 3 }),
    });
    const patchBody = await patch.json();
    expect(patchBody.credential.label).toBe('Updated Project A');
    expect(patchBody.credential.weight).toBe(3);

    const testResponse = await fetch(`${baseUrl}/admin/api/vertex-credentials/${id}/test`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret' },
    });
    expect(testResponse.status).toBe(200);
    expect(runtime.probeTarget).toHaveBeenCalled();

    const modelPut = await fetch(`${baseUrl}/admin/api/models/gemini`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        defaultModel: 'gemini-2.5-flash',
        aliases: { fast: 'gemini-2.5-flash' },
        allowlist: ['gemini-2.5-flash'],
        disabled: [],
      }),
    });
    expect(modelPut.status).toBe(200);

    const modelGet = await fetch(`${baseUrl}/admin/api/models?provider=gemini`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const modelGetBody = await modelGet.json();
    expect(modelGetBody.defaultModel).toBe('gemini-2.5-flash');

    const reload = await fetch(`${baseUrl}/admin/api/runtime/reload`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret' },
    });
    expect(reload.status).toBe(200);
    expect(runtime.reload).toHaveBeenCalled();

    const remove = await fetch(`${baseUrl}/admin/api/vertex-credentials/${id}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-secret' },
    });
    const removeBody = await remove.json();
    expect(removeBody.remaining).toBe(0);
  });

  it('rejects invalid JSON bodies and oversized admin payloads with client errors', async () => {
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        maxJsonBytes: 32,
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);

    const invalidJson = await fetch(`${baseUrl}/admin/api/models/gemini`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer admin-secret',
        'content-type': 'application/json',
      },
      body: '{',
    });
    const invalidJsonBody = await invalidJson.json();
    expect(invalidJson.status).toBe(400);
    expect(invalidJsonBody.error.code).toBe('VALIDATION_FAILED');

    const tooLarge = await fetch(`${baseUrl}/admin/api/models/gemini`, {
      method: 'PUT',
      headers: {
        authorization: 'Bearer admin-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aliases: { huge: 'x'.repeat(128) } }),
    });
    const tooLargeBody = await tooLarge.json();
    expect(tooLarge.status).toBe(413);
    expect(tooLargeBody.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed imported credentials before persisting them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin/api/vertex-credentials/import`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project: 'project-a',
        location: 'global',
        credential: {
          type: 'service_account',
          project_id: 'project-a',
          private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        },
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/client_email is required/i);
  });

  it('rolls back admin store changes when runtime reload fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    runtime.reload = vi.fn(() => {
      throw new Error('reload failed');
    });
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = {
      authorization: 'Bearer admin-secret',
      'content-type': 'application/json',
    };

    const failedImport = await fetch(`${baseUrl}/admin/api/vertex-credentials/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: 'project-a',
        location: 'global',
        credential: {
          type: 'service_account',
          project_id: 'project-a',
          client_email: 'svc@example.test',
          private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
        },
      }),
    });
    expect(failedImport.status).toBe(500);

    const list = await fetch(`${baseUrl}/admin/api/vertex-credentials`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(listBody.vertexPools).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir, 'credentials'))).toEqual([]);
  });

  it('serves the admin dashboard shell from the gateway', async () => {
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
      }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/admin`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Gateway Admin');
    expect(html).toContain('id="username-input"');
    expect(html).toContain('id="password-input"');
    expect(html).toContain('id="password-change-panel"');
    expect(html).toContain('id="credential-list"');
  });

  it('creates, lists, and revokes managed gateway keys without leaking secrets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

    const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Mobile app' }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(200);
    expect(createdBody.secret).toMatch(/^vgw_/);
    expect(createdBody.gatewayKey.label).toBe('Mobile app');
    expect(createdBody.gatewayKey.hash).toBeUndefined();

    const secret = createdBody.secret as string;
    const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.gatewayKeys).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain(secret);
    expect(JSON.stringify(fs.readFileSync(path.join(dir, 'gateway-keys.json'), 'utf8'))).not.toContain(secret);
    expect(runtime.reload).toHaveBeenCalled();

    const id = listBody.gatewayKeys[0].id as string;
    const revoked = await fetch(`${baseUrl}/admin/api/gateway-keys/${id}/revoke`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret' },
    });
    const revokedBody = await revoked.json();
    expect(revoked.status).toBe(200);
    expect(revokedBody.gatewayKey.status).toBe('revoked');
  });

  it('keeps managed gateway keys active after unrelated admin config reloads', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const adminHeaders = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

    const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'Mobile app' }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(200);

    const target = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'Global key', project: 'project-a', location: 'global', apiKey: 'google-secret' }),
    });
    expect(target.status).toBe(200);

    const completion = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${createdBody.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(completion.status).toBe(200);
  });

  it('rolls back managed gateway key persistence when runtime reload fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    runtime.reload = vi.fn(() => {
      throw new Error('reload failed');
    });
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

    const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Mobile app' }),
    });
    expect(created.status).toBe(500);

    const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(listBody.gatewayKeys).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'gateway-keys.json'))).toBe(false);
  });

  it('lists static config gateway keys but rejects managed key mutations in read-only mode', async () => {
    server = createApp({
      config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
      runtimeFactory: () => createFakeRuntime(),
    });
    const baseUrl = await listen(server);
    const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.mutable).toBe(false);
    expect(JSON.stringify(listBody)).not.toContain('test-key');

    const create = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Blocked' }),
    });
    expect(create.status).toBe(400);
  });

  it('creates API-key Vertex targets without exposing raw upstream keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Global key', project: 'project-a', location: 'global', apiKey: 'google-secret' }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.credential.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain('google-secret');

    const list = await fetch(`${baseUrl}/admin/api/vertex-credentials`, { headers: { authorization: 'Bearer admin-secret' } });
    const listBody = await list.json();
    expect(JSON.stringify(listBody)).not.toContain('google-secret');
    expect(runtime.reload).toHaveBeenCalled();
  });

  it('rejects duplicate API-key Vertex targets instead of replacing them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
        runtimeMode: 'pool',
        vertexPools: [],
        resolvedVertexTargets: [],
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };
    const payload = { label: 'Global key', project: 'project-a', location: 'global', apiKey: 'google-secret' };

    const first = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);

    const duplicate = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, apiKey: 'replacement-secret' }),
    });
    const duplicateBody = await duplicate.json();
    expect(duplicate.status).toBe(400);
    expect(duplicateBody.error.message).toMatch(/already exists/i);

    const list = await fetch(`${baseUrl}/admin/api/vertex-credentials`, { headers: { authorization: 'Bearer admin-secret' } });
    const listBody = await list.json();
    expect(listBody.vertexPools).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain('replacement-secret');
  });

  it('applies admin-updated OpenAI model catalog rules without restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    await seedChangedAdminPassword(dir);
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const adminHeaders = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

    const modelPut = await fetch(`${baseUrl}/admin/api/models/openai`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        aliases: { fast: 'gemini-3.5-flash' },
        allowlist: ['gemini-3.5-flash'],
        disabled: [],
      }),
    });
    expect(modelPut.status).toBe(200);

    const completion = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'fast',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(completion.status).toBe(200);
    expect(runtime.client.models.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.5-flash' }),
      expect.any(Object),
    );
  });
});
