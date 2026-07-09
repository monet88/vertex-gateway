import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGatewayKeyStore, verifyManagedGatewayKey } from '../src/admin/gateway-key-store.js';
import { testConfig } from './test-config.js';

const tempStoreConfig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-keys-'));
  return testConfig({
    enableAdminRoutes: true,
    adminToken: 'admin-secret',
    adminAllowMutations: true,
    adminStoreMode: 'file-store',
    adminFileStoreDir: dir,
  });
};

describe('gateway key store', () => {
  it('creates a managed key, returns the secret once, and stores only a hash', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config);
    const created = store.create({ label: 'Mobile app' });
    expect(created.secret).toMatch(/^vgw_/);
    expect(created.gatewayKey.label).toBe('Mobile app');
    expect(created.gatewayKey.preview).toContain('vgw_');
    expect(JSON.stringify(store.getSnapshot())).not.toContain(created.secret);
    expect(verifyManagedGatewayKey(created.secret, store.getActiveHashes())).toBe(true);
  });

  it('revokes a managed key without deleting its metadata', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config);
    const created = store.create({ label: 'CLI smoke' });
    const revoked = store.revoke(created.gatewayKey.id);
    expect(revoked.gatewayKey.status).toBe('revoked');
    expect(verifyManagedGatewayKey(created.secret, store.getActiveHashes())).toBe(false);
  });

  it('deletes a managed key and removes it from active hashes', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config);
    const created = store.create({ label: 'Temporary key' });

    const deleted = store.delete(created.gatewayKey.id);

    expect(deleted.gatewayKey.id).toBe(created.gatewayKey.id);
    expect(store.getSnapshot().gatewayKeys).toEqual([]);
    expect(verifyManagedGatewayKey(created.secret, store.getActiveHashes())).toBe(false);
  });

  it('does not create the file-store directory for read-only snapshots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-keys-'));
    const storeDir = path.join(root, 'missing-store');
    const store = createGatewayKeyStore(testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: storeDir,
    }));

    expect(store.getSnapshot().gatewayKeys).toEqual([]);
    expect(fs.existsSync(storeDir)).toBe(false);
    store.create({ label: 'Mobile app' });
    expect(fs.existsSync(storeDir)).toBe(true);
  });

  it('lists static config keys as read-only sanitized previews', () => {
    const store = createGatewayKeyStore(testConfig({ gatewayKeys: ['test-key', 'second-key', 'abcd'] }));
    const snapshot = store.getSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.mode).toBe('static-config');
    expect(snapshot.mutable).toBe(false);
    expect(snapshot.gatewayKeys).toHaveLength(3);
    expect(serialized).not.toContain('second-key');
    expect(serialized).not.toContain('abcd');
  });

  it('rejects create in static-config mode', () => {
    const store = createGatewayKeyStore(testConfig());
    expect(() => store.create({ label: 'Blocked' })).toThrow(/read-only/i);
  });

  it('preserves the original error when rollback also fails', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config, () => {
      throw new Error('reload failed');
    });
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw new Error('rollback failed');
    });

    try {
      expect(() => store.create({ label: 'Mobile app' })).toThrow(/reload failed/);
    } finally {
      rmSpy.mockRestore();
    }
  });
});
