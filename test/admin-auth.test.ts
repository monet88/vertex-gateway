import { describe, expect, it } from 'vitest';
import { requireAdminAuth } from '../src/admin/admin-auth.js';
import { testConfig } from './test-config.js';

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
});
