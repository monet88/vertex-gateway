import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requireAdminAuth } from '../src/admin/admin-auth.js';
import { clearPersistedAdminSessionToken } from '../src/admin/admin-session.js';
import { persistAdminFileStoreSettings } from '../src/config/admin-settings-store.js';
import { testConfig } from './test-config.js';

const tempRoots: string[] = [];

const createTempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-gateway-admin-auth-'));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('admin auth', () => {
  it('accepts only Authorization Bearer with the admin token', () => {
    expect(() => requireAdminAuth({
      authorization: 'Bearer admin-secret',
    }, testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }))).not.toThrow();
  });

  it('rejects missing bearer, gateway keys, and x-api-key transports', () => {
    const config = testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      gatewayKeys: ['gateway-key'],
    });

    expect(() => requireAdminAuth({}, config)).toThrow(/Admin authorization failed/);
    expect(() => requireAdminAuth({ authorization: 'Bearer gateway-key' }, config)).toThrow(/Admin authorization failed/);
    expect(() => requireAdminAuth({ 'x-api-key': 'admin-secret' }, config)).toThrow(/Admin authorization failed/);
  });

  it('rejects an expired file-store session token on repeated requests after clearing it', () => {
    const adminFileStoreDir = createTempRoot();
    const config = testConfig({
      enableAdminRoutes: true,
      adminToken: 'expired-session-token',
      adminStoreMode: 'file-store',
      adminFileStoreDir,
    });

    persistAdminFileStoreSettings(config, {
      adminSessionToken: 'expired-session-token',
      adminSessionTokenCreatedAt: new Date(Date.now() - (13 * 60 * 60 * 1000)).toISOString(),
    });

    expect(() => requireAdminAuth({ authorization: 'Bearer expired-session-token' }, config)).toThrow(/Admin authorization failed/);
    expect(config.adminToken).toBeNull();

    expect(() => requireAdminAuth({ authorization: 'Bearer expired-session-token' }, config)).toThrow(/Admin authorization failed/);
  });
});
