import { describe, expect, it } from 'vitest';
import {
  toGatewayError,
  maskSensitiveInfo,
  formatOpenAiErrorBody,
  formatGatewayErrorBody,
  safeErrorMessage,
  GatewayError,
} from '../src/http/error-response.js';
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

describe('maskSensitiveInfo', () => {
  it('masks project and location IDs in messages', () => {
    const original = 'Failed to find project projects/my-cool-project-123 in locations/us-central1-a';
    const masked = maskSensitiveInfo(original);
    expect(masked).toBe('Failed to find project projects/<masked-project> in locations/<masked-location>');
  });

  it('handles multiple occurrences and is case-insensitive', () => {
    const original = 'PROJECTS/A-b-C-1 locations/XYZ';
    const masked = maskSensitiveInfo(original);
    expect(masked).toBe('projects/<masked-project> locations/<masked-location>');
  });
});

describe('formatOpenAiErrorBody mapping', () => {
  it('maps UPSTREAM_QUOTA to requests_error/rate_limit_exceeded', () => {
    const err = new GatewayError(429, 'UPSTREAM_QUOTA', 'Quota exceeded');
    const body = formatOpenAiErrorBody(err);
    expect(body).toEqual({
      error: {
        message: 'Quota exceeded',
        type: 'requests_error',
        code: 'rate_limit_exceeded',
      },
    });
  });

  it('maps AUTH_INVALID and CORS_DENIED to invalid_request_error/invalid_api_key', () => {
    const err1 = new GatewayError(401, 'AUTH_INVALID', 'Auth failed');
    expect(formatOpenAiErrorBody(err1)).toEqual({
      error: {
        message: 'Auth failed',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });

    const err2 = new GatewayError(403, 'CORS_DENIED', 'CORS blocked');
    expect(formatOpenAiErrorBody(err2)).toEqual({
      error: {
        message: 'CORS blocked',
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    });
  });

  it('maps VALIDATION_FAILED and PAYLOAD_TOO_LARGE to invalid_request_error/invalid_value', () => {
    const err1 = new GatewayError(400, 'VALIDATION_FAILED', 'Validation failed');
    expect(formatOpenAiErrorBody(err1)).toEqual({
      error: {
        message: 'Validation failed',
        type: 'invalid_request_error',
        code: 'invalid_value',
      },
    });

    const err2 = new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
    expect(formatOpenAiErrorBody(err2)).toEqual({
      error: {
        message: 'Payload too large',
        type: 'invalid_request_error',
        code: 'invalid_value',
      },
    });
  });

  it('maps NOT_FOUND to invalid_request_error/model_not_found', () => {
    const err = new GatewayError(404, 'NOT_FOUND', 'Not found');
    expect(formatOpenAiErrorBody(err)).toEqual({
      error: {
        message: 'Not found',
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    });
  });

  it('maps TIMEOUT to server_error/timeout', () => {
    const err = new GatewayError(504, 'TIMEOUT', 'Timed out');
    expect(formatOpenAiErrorBody(err)).toEqual({
      error: {
        message: 'Timed out',
        type: 'server_error',
        code: 'timeout',
      },
    });
  });

  it('maps METHOD_NOT_ALLOWED and NOT_IMPLEMENTED to invalid_request_error/invalid_value', () => {
    const err1 = new GatewayError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    expect(formatOpenAiErrorBody(err1)).toEqual({
      error: {
        message: 'Method not allowed',
        type: 'invalid_request_error',
        code: 'invalid_value',
      },
    });

    const err2 = new GatewayError(501, 'NOT_IMPLEMENTED', 'Not implemented');
    expect(formatOpenAiErrorBody(err2)).toEqual({
      error: {
        message: 'Not implemented',
        type: 'invalid_request_error',
        code: 'invalid_value',
      },
    });
  });

  it('falls back to default server_error/internal_error for other codes', () => {
    const err = new GatewayError(500, 'INTERNAL', 'Internal error');
    expect(formatOpenAiErrorBody(err)).toEqual({
      error: {
        message: 'Internal error',
        type: 'server_error',
        code: 'internal_error',
      },
    });
  });

  it('masks projects/locations in formatted OpenAI error message', () => {
    const err = new GatewayError(404, 'NOT_FOUND', 'Cannot find projects/my-project in locations/us-central1');
    const body = formatOpenAiErrorBody(err);
    expect(body.error).toMatchObject({
      message: 'Cannot find projects/<masked-project> in locations/<masked-location>',
    });
  });
});

describe('formatGatewayErrorBody and safeErrorMessage', () => {
  it('masks projects/locations in formatGatewayErrorBody', () => {
    const err = new GatewayError(400, 'VALIDATION_FAILED', 'Invalid project projects/p1');
    const body = formatGatewayErrorBody('req-123', err);
    expect(body).toEqual({
      success: false,
      requestId: 'req-123',
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid project projects/<masked-project>',
        retryable: undefined,
      },
    });
  });

  it('extracts messages correctly using safeErrorMessage', () => {
    expect(safeErrorMessage(new Error('direct message'))).toBe('direct message');
    expect(safeErrorMessage({ message: 'object message' })).toBe('object message');
    expect(safeErrorMessage('plain text')).toBe('plain text');
    expect(safeErrorMessage(null)).toBe('null');
  });
});
