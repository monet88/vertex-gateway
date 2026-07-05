import { describe, expect, it } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { applyCors } from '../src/lib/cors.js';
import { testConfig } from './test-config.js';

const requestWithOrigin = (origin?: string) => {
  const req = new IncomingMessage(new Socket());
  req.headers = origin ? { origin } : {};
  return req;
};

const createResponse = () => new ServerResponse(requestWithOrigin());

describe('cors', () => {
  it('allows any origin by default and includes Gemini SDK preflight headers', () => {
    const res = createResponse();
    applyCors(
      requestWithOrigin('https://changstore-da7p92082-monet421992.vercel.app'),
      res,
      testConfig({ corsOrigins: [] }),
    );

    expect(res.getHeader('access-control-allow-origin')).toBe('https://changstore-da7p92082-monet421992.vercel.app');
    expect(res.getHeader('access-control-allow-headers')).toBe(
      'authorization, content-type, x-api-key, x-goog-api-key, x-goog-api-client, x-request-id',
    );
  });

  it('allows configured origins and includes Gemini SDK preflight headers', () => {
    const res = createResponse();
    applyCors(requestWithOrigin('http://localhost:3000'), res, testConfig());

    expect(res.getHeader('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.getHeader('access-control-allow-headers')).toBe(
      'authorization, content-type, x-api-key, x-goog-api-key, x-goog-api-client, x-request-id',
    );
  });

  it('rejects origins outside an explicit allowlist', () => {
    const res = createResponse();
    expect(() => applyCors(
      requestWithOrigin('https://blocked.example'),
      res,
      testConfig({ corsOrigins: ['https://app.example'] }),
    )).toThrow(/not allowed/);
  });

  it('rejects wildcard CORS for non-local origins by default', () => {
    const res = createResponse();
    expect(() => applyCors(
      requestWithOrigin('https://evil.example'),
      res,
      testConfig({ corsOrigins: ['*'], allowWildcardCors: false }),
    )).toThrow(/wildcard c o r s|wildcard cors/i);
  });

  it('allows wildcard CORS for localhost during local development', () => {
    const res = createResponse();
    applyCors(
      requestWithOrigin('http://localhost:3001'),
      res,
      testConfig({ corsOrigins: ['*'], allowWildcardCors: false }),
    );

    expect(res.getHeader('access-control-allow-origin')).toBe('http://localhost:3001');
  });

  it('allows an explicitly listed origin even when wildcard is also configured but restricted', () => {
    const res = createResponse();
    applyCors(
      requestWithOrigin('https://app.example'),
      res,
      testConfig({ corsOrigins: ['https://app.example', '*'], allowWildcardCors: false }),
    );

    expect(res.getHeader('access-control-allow-origin')).toBe('https://app.example');
  });
});
