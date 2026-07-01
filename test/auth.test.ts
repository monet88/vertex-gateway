import { describe, expect, it } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { requireGatewayAuth } from '../src/auth/gateway-auth.js';
import { testConfig } from './test-config.js';

const requestWithHeaders = (headers: Record<string, string>) => {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  return req;
};

describe('gateway auth', () => {
  it('accepts bearer gateway keys', () => {
    expect(() => requireGatewayAuth(requestWithHeaders({ authorization: 'Bearer test-key' }), testConfig())).not.toThrow();
  });

  it('accepts x-api-key and x-goog-api-key gateway keys', () => {
    expect(() => requireGatewayAuth(requestWithHeaders({ 'x-api-key': 'test-key' }), testConfig())).not.toThrow();
    expect(() => requireGatewayAuth(requestWithHeaders({ 'x-goog-api-key': 'test-key' }), testConfig())).not.toThrow();
  });

  it('rejects missing and invalid keys', () => {
    expect(() => requireGatewayAuth(requestWithHeaders({}), testConfig())).toThrow(/required/);
    expect(() => requireGatewayAuth(requestWithHeaders({ 'x-api-key': 'wrong' }), testConfig())).toThrow(/invalid/);
  });
});
