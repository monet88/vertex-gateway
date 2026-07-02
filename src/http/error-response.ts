import type { ServerResponse } from 'node:http';

export type GatewayErrorCode =
  | 'AUTH_INVALID'
  | 'RATE_LIMITED'
  | 'CORS_DENIED'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'METHOD_NOT_ALLOWED'
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'TIMEOUT'
  | 'UPSTREAM_QUOTA'
  | 'UPSTREAM_UNAVAILABLE'
  | 'IMAGE_NOT_RETURNED'
  | 'INTERNAL';

export type ErrorFormat = 'gateway' | 'openai';

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: GatewayErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

export const formatGatewayErrorBody = (
  requestId: string,
  gatewayError: GatewayError,
): Record<string, unknown> => ({
  success: false,
  requestId,
  error: {
    code: gatewayError.code,
    message: maskSensitiveInfo(gatewayError.message),
    retryable: gatewayError.retryable || undefined,
  },
});

export const maskSensitiveInfo = (message: string): string =>
  message
    .replace(/projects\/[a-z0-9-]+/gi, 'projects/<masked-project>')
    .replace(/locations\/[a-z0-9-]+/gi, 'locations/<masked-location>');

// OpenAI SDK clients expect a bare { error: { message, type, code } } envelope
// with no gateway wrapper. See spec §3.
export const formatOpenAiErrorBody = (
  gatewayError: GatewayError,
): Record<string, unknown> => {
  let type = 'server_error';
  let code: string | null = 'internal_error';
  switch (gatewayError.code) {
    case 'UPSTREAM_QUOTA':
      type = 'requests_error'; code = 'rate_limit_exceeded'; break;
    case 'AUTH_INVALID':
    case 'CORS_DENIED':
      type = 'invalid_request_error'; code = 'invalid_api_key'; break;
    case 'VALIDATION_FAILED':
    case 'PAYLOAD_TOO_LARGE':
      type = 'invalid_request_error'; code = 'invalid_value'; break;
    case 'NOT_FOUND':
      type = 'invalid_request_error'; code = 'model_not_found'; break;
    case 'TIMEOUT':
      type = 'server_error'; code = 'timeout'; break;
    case 'METHOD_NOT_ALLOWED':
    case 'NOT_IMPLEMENTED':
      type = 'invalid_request_error'; code = 'invalid_value'; break;
    // IMAGE_NOT_RETURNED, INTERNAL, UPSTREAM_UNAVAILABLE → default
  }
  return { error: { message: maskSensitiveInfo(gatewayError.message), type, code } };
};

export const sendError = (
  res: ServerResponse,
  requestId: string,
  error: unknown,
  format: ErrorFormat = 'gateway',
): void => {
  const gatewayError = toGatewayError(error);
  const body = format === 'openai'
    ? formatOpenAiErrorBody(gatewayError)
    : formatGatewayErrorBody(requestId, gatewayError);
  sendJson(res, gatewayError.status, body);
};

export const safeErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  try {
    return String(error);
  } catch {
    return '';
  }
};

export const gatewayErrorFromStatus = (
  status: number,
  message: string,
): GatewayError | undefined => {
  if (status === 404) {
    return new GatewayError(404, 'NOT_FOUND', 'Upstream model or route was not found.');
  }
  if (status === 413) {
    return new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Upstream request payload was too large.');
  }
  if (status === 400 || status === 422) {
    return new GatewayError(400, 'VALIDATION_FAILED', 'Upstream request was rejected as invalid.');
  }
  if (status === 401 || status === 403) {
    return new GatewayError(401, 'AUTH_INVALID', 'Upstream authentication failed.');
  }
  if (status === 429) {
    return new GatewayError(429, 'UPSTREAM_QUOTA', 'Upstream quota exhausted.', true);
  }
  if (status === 408 || status === 504) {
    return new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
  }
  if (status >= 500) {
    return new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Upstream service is unavailable.', true);
  }
  return undefined;
};

export const toGatewayError = (error: unknown): GatewayError => {
  if (error instanceof GatewayError) return error;
  const message = safeErrorMessage(error);
  if (/\b413\b|payload too large/i.test(message)) {
    return new GatewayError(413, 'PAYLOAD_TOO_LARGE', 'Upstream request payload was too large.');
  }
  if (/\b404\b|not found/i.test(message)) {
    return new GatewayError(404, 'NOT_FOUND', 'Upstream model or route was not found.');
  }
  if (/400|validation|invalid argument|bad request/i.test(message)) {
    return new GatewayError(400, 'VALIDATION_FAILED', 'Upstream request was rejected as invalid.');
  }
  if (/401|403|permission|unauthorized|forbidden|invalid credentials|auth/i.test(message)) {
    return new GatewayError(401, 'AUTH_INVALID', 'Upstream authentication failed.');
  }
  if (/429|resource_exhausted|quota/i.test(message)) {
    return new GatewayError(429, 'UPSTREAM_QUOTA', 'Upstream quota exhausted.', true);
  }
  if (/timeout|aborted/i.test(message)) {
    return new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
  }
  if (/5\d\d|unavailable|internal server error|bad gateway|service unavailable|upstream/i.test(message)) {
    return new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Upstream service is unavailable.', true);
  }
  return new GatewayError(500, 'INTERNAL', 'Internal gateway error.');
};
