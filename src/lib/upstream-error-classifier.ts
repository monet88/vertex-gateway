import { GatewayError, toGatewayError, type GatewayErrorCode } from '../http/error-response.js';

export interface UpstreamErrorClassification {
  code: GatewayErrorCode;
  retryable: boolean;
  shouldCooldown: boolean;
  shouldFailover: boolean;
}

export const classifyUpstreamError = (error: unknown): UpstreamErrorClassification => {
  const gatewayError = toGatewayError(error);
  if (gatewayError.code === 'VALIDATION_FAILED' || gatewayError.code === 'PAYLOAD_TOO_LARGE') {
    return {
      code: gatewayError.code,
      retryable: false,
      shouldCooldown: false,
      shouldFailover: false,
    };
  }

  if (gatewayError.code === 'AUTH_INVALID') {
    return {
      code: gatewayError.code,
      retryable: false,
      shouldCooldown: true,
      shouldFailover: true,
    };
  }

  if (
    gatewayError.code === 'UPSTREAM_QUOTA'
    || gatewayError.code === 'UPSTREAM_UNAVAILABLE'
    || gatewayError.code === 'TIMEOUT'
  ) {
    return {
      code: gatewayError.code,
      retryable: true,
      shouldCooldown: true,
      shouldFailover: true,
    };
  }

  return {
    code: gatewayError.code,
    retryable: gatewayError.retryable,
    shouldCooldown: gatewayError.retryable,
    shouldFailover: gatewayError.retryable,
  };
};

export const withClassifiedGatewayError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;
  return toGatewayError(error);
};
