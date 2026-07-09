import { describe, expect, it } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { requireGatewayAuth } from '../src/auth/gateway-auth.js';
import { hashGatewayKey } from '../src/admin/gateway-key-store.js';
import { testConfig } from './test-config.js';

const requestWithHeaders = (headers: Record<string, string>) => {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  return req;
};

describe('gateway auth', () => {
  it('accepts bearer gateway keys and returns the key', () => {
    expect(requireGatewayAuth(requestWithHeaders({ authorization: 'Bearer test-key' }), testConfig())).toBe('test-key');
  });

  it('accepts x-api-key and x-goog-api-key gateway keys', () => {
    expect(requireGatewayAuth(requestWithHeaders({ 'x-api-key': 'test-key' }), testConfig())).toBe('test-key');
    expect(requireGatewayAuth(requestWithHeaders({ 'x-goog-api-key': 'test-key' }), testConfig())).toBe('test-key');
  });

  it('rejects missing and invalid keys', () => {
    expect(() => requireGatewayAuth(requestWithHeaders({}), testConfig())).toThrow(/required/);
    expect(() => requireGatewayAuth(requestWithHeaders({ 'x-api-key': 'wrong' }), testConfig())).toThrow(/invalid/);
  });

  it('accepts managed gateway keys by hash and rejects after removal', () => {
    const secret = 'vgw_managed-key-for-auth-test';
    const hash = hashGatewayKey(secret);
    const config = testConfig({ managedGatewayKeyHashes: [hash], gatewayKeys: [] });
    expect(requireGatewayAuth(requestWithHeaders({ authorization: `Bearer ${secret}` }), config)).toBe(secret);
    const emptyConfig = testConfig({ managedGatewayKeyHashes: [], gatewayKeys: ['test-key'] });
    expect(() => requireGatewayAuth(requestWithHeaders({ authorization: `Bearer ${secret}` }), emptyConfig)).toThrow(/invalid/);
  });

  it('matches among multiple prehashed static keys without dual-hashing configured secrets per compare', () => {
    const config = testConfig({ gatewayKeys: ['alpha-key', 'beta-key', 'gamma-key'] });
    expect(config.gatewayKeyDigests).toHaveLength(3);
    expect(requireGatewayAuth(requestWithHeaders({ authorization: 'Bearer beta-key' }), config)).toBe('beta-key');
  });
});
