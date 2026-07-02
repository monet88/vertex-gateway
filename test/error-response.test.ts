import { describe, expect, it } from 'vitest';
import { toGatewayError } from '../src/http/error-response.js';
import { ApiError } from '@google/genai';
import { getErrorStatus, classifyUpstreamError } from '../src/lib/upstream-error-classifier.js';

describe('error response mapping', () => {
  it('maps non-Error thrown details without leaking raw 500 messages', () => {
    const error = toGatewayError('plain failure');

    expect(error.status).toBe(500);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Internal gateway error.');
  });

  it('does not throw while mapping non-Error values with unsafe coercion hooks', () => {
    const error = toGatewayError({
      toString() {
        throw new Error('coercion exploded');
      },
    });

    expect(error.status).toBe(500);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Internal gateway error.');
  });

  it('maps upstream 404 model errors to a visible not-found gateway error', () => {
    const error = toGatewayError('{"error":{"message":"","code":404,"status":"Not Found"}}');

    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Upstream model or route was not found.');
  });
});

describe('getErrorStatus', () => {
  it('reads status from a @google/genai ApiError', () => {
    const error = new ApiError({ message: 'quota', status: 429 });
    expect(getErrorStatus(error)).toBe(429);
  });

  it('reads a plain .status field', () => {
    expect(getErrorStatus({ status: 404 })).toBe(404);
  });

  it('reads .statusCode and .code fields', () => {
    expect(getErrorStatus({ statusCode: 503 })).toBe(503);
    expect(getErrorStatus({ code: 400 })).toBe(400);
  });

  it('reads a nested .response.status field', () => {
    expect(getErrorStatus({ response: { status: 401 } })).toBe(401);
  });

  it('reads .error.code duck-typed status', () => {
    expect(getErrorStatus({ error: { code: 422 } })).toBe(422);
  });

  it('returns undefined when no status is present', () => {
    expect(getErrorStatus(new Error('mystery'))).toBeUndefined();
    expect(getErrorStatus('plain string')).toBeUndefined();
  });

  it('ignores a string .code such as ECONNRESET', () => {
    expect(getErrorStatus({ code: 'ECONNRESET' })).toBeUndefined();
  });

  it('ignores gRPC-style low integer .code outside the HTTP range', () => {
    expect(getErrorStatus({ code: 8 })).toBeUndefined();
    expect(getErrorStatus({ code: 14 })).toBeUndefined();
  });
});

describe('classifyUpstreamError status mapping', () => {
  it('maps 429 to retryable quota with cooldown + failover', () => {
    const c = classifyUpstreamError(new ApiError({ message: 'x', status: 429 }));
    expect(c.code).toBe('UPSTREAM_QUOTA');
    expect(c).toMatchObject({ retryable: true, shouldCooldown: true, shouldFailover: true });
  });

  it('maps 401/403 to non-retryable auth with cooldown + failover', () => {
    for (const status of [401, 403]) {
      const c = classifyUpstreamError({ status });
      expect(c.code).toBe('AUTH_INVALID');
      expect(c).toMatchObject({ retryable: false, shouldCooldown: true, shouldFailover: true });
    }
  });

  it('maps 400/422 to validation with no retry, no cooldown, no failover', () => {
    for (const status of [400, 422]) {
      const c = classifyUpstreamError({ status });
      expect(c.code).toBe('VALIDATION_FAILED');
      expect(c).toMatchObject({ retryable: false, shouldCooldown: false, shouldFailover: false });
    }
  });

  it('maps 404 to not-found', () => {
    expect(classifyUpstreamError({ status: 404 }).code).toBe('NOT_FOUND');
  });

  it('maps 413 to payload too large with no retry, cooldown, or failover', () => {
    const c = classifyUpstreamError({ status: 413 });
    expect(c.code).toBe('PAYLOAD_TOO_LARGE');
    expect(c).toMatchObject({ retryable: false, shouldCooldown: false, shouldFailover: false });

    const msgErr = classifyUpstreamError(new Error('upstream: payload too large'));
    expect(msgErr.code).toBe('PAYLOAD_TOO_LARGE');
    expect(msgErr.retryable).toBe(false);
  });

  it('maps 500/503 to retryable transient', () => {
    for (const status of [500, 503]) {
      const c = classifyUpstreamError({ status });
      expect(c.retryable).toBe(true);
    }
  });

  it('maps 408/504 to timeout', () => {
    for (const status of [408, 504]) {
      const c = classifyUpstreamError({ status });
      expect(c.code).toBe('TIMEOUT');
      expect(c).toMatchObject({ retryable: true, shouldCooldown: true, shouldFailover: true });
    }
  });

  it('falls back to message regex when no status is present', () => {
    const c = classifyUpstreamError(new Error('429 resource_exhausted'));
    expect(c.code).toBe('UPSTREAM_QUOTA');
    expect(c.retryable).toBe(true);
  });

  it('prefers status over the message regex', () => {
    const error = new ApiError({ message: '429 resource_exhausted', status: 400 });
    const c = classifyUpstreamError(error);
    expect(c.code).toBe('VALIDATION_FAILED');
  });

  it('ignores gRPC-style low integer .code and falls back to message', () => {
    const c = classifyUpstreamError({ code: 8, message: '429 quota' });
    expect(c.code).toBe('UPSTREAM_QUOTA');
  });
});
