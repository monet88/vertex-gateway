import { ApiError } from '@google/genai';
import {
  GatewayError,
  gatewayErrorFromStatus,
  toGatewayError,
  type GatewayErrorCode,
} from '../http/error-response.js';

export interface UpstreamErrorClassification {
  code: GatewayErrorCode;
  retryable: boolean;
  shouldCooldown: boolean;
  shouldFailover: boolean;
}

const asFiniteInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Accept a value as an HTTP status only when it falls inside the valid HTTP
 * range. This guards against `.code`-style fields that are not HTTP statuses:
 * @google/genai / gRPC errors expose `.code` as a small canonical integer
 * (0-16, e.g. 8=RESOURCE_EXHAUSTED, 14=UNAVAILABLE) or a string like
 * 'ECONNRESET' — neither of which should be treated as an HTTP status.
 */
const asHttpStatus = (value: unknown): number | undefined => {
  const num = asFiniteInt(value);
  return num !== undefined && num >= 100 && num < 600 ? num : undefined;
};

/**
 * Single source of truth for pulling an HTTP status out of an unknown upstream
 * error. Detection priority (first match wins) per spec §2:
 *   1. @google/genai ApiError.status (a real HTTP status)
 *   2. error.status / error.statusCode / error.code (HTTP-range guarded)
 *   3. error.response?.status / error.response?.statusCode (HTTP-range guarded)
 *   4. error.error?.code / error.error?.status (duck typing, HTTP-range guarded)
 * Every non-ApiError source is passed through asHttpStatus so non-HTTP `.code`
 * values (gRPC integers, string errno) are ignored. Message-regex extraction is
 * intentionally left to toGatewayError as a last resort inside
 * classifyUpstreamError.
 */
export const getErrorStatus = (error: unknown): number | undefined => {
  if (error instanceof ApiError) {
    const status = asFiniteInt(error.status);
    if (status !== undefined) return status;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const direct = asHttpStatus(record.status) ?? asHttpStatus(record.statusCode) ?? asHttpStatus(record.code);
    if (direct !== undefined) return direct;
    const response = record.response;
    if (response && typeof response === 'object') {
      const nested = asHttpStatus((response as Record<string, unknown>).status)
        ?? asHttpStatus((response as Record<string, unknown>).statusCode);
      if (nested !== undefined) return nested;
    }
    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const duck = asHttpStatus((nestedError as Record<string, unknown>).code)
        ?? asHttpStatus((nestedError as Record<string, unknown>).status);
      if (duck !== undefined) return duck;
    }
  }
  return undefined;
};

const decisionFor = (gatewayError: GatewayError): UpstreamErrorClassification => {
  if (gatewayError.code === 'VALIDATION_FAILED' || gatewayError.code === 'PAYLOAD_TOO_LARGE') {
    return { code: gatewayError.code, retryable: false, shouldCooldown: false, shouldFailover: false };
  }
  if (gatewayError.code === 'AUTH_INVALID') {
    return { code: gatewayError.code, retryable: false, shouldCooldown: true, shouldFailover: true };
  }
  if (
    gatewayError.code === 'UPSTREAM_QUOTA'
    || gatewayError.code === 'UPSTREAM_UNAVAILABLE'
    || gatewayError.code === 'TIMEOUT'
  ) {
    return { code: gatewayError.code, retryable: true, shouldCooldown: true, shouldFailover: true };
  }
  return {
    code: gatewayError.code,
    retryable: gatewayError.retryable,
    shouldCooldown: gatewayError.retryable,
    shouldFailover: gatewayError.retryable,
  };
};

export const classifyUpstreamError = (error: unknown): UpstreamErrorClassification => {
  if (error instanceof GatewayError) return decisionFor(error);
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const gatewayError = (status !== undefined && gatewayErrorFromStatus(status, message))
    || toGatewayError(error);
  return decisionFor(gatewayError);
};

export const withClassifiedGatewayError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (status !== undefined && gatewayErrorFromStatus(status, message)) || toGatewayError(error);
};
