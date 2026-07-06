import type { ClassifiedRoute } from '../http/request-classifier.js';
import { GatewayError } from '../http/error-response.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import type { GenAiRequestMetadata } from '../lib/genai-request-metadata.js';

const buildGenerateRequest = (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
): Record<string, unknown> => ({ ...body, model: route.model });

const compatibilityMetadata = (
  route: ClassifiedRoute,
  requestId?: string,
  signal?: AbortSignal,
): GenAiRequestMetadata => ({
  routeFamily: 'gemini',
  ...(requestId ? { requestId } : {}),
  ...(signal ? { signal } : {}),
});

export const runCompatibilityRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
  signal?: AbortSignal,
  modelsResponse?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  if (route.operation === 'models') return modelsResponse ?? { models: [] };
  return ai.models.generateContent(
    buildGenerateRequest(route, body),
    compatibilityMetadata(route, requestId, signal),
  );
};

export const runCompatibilityStreamRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
  streamConfig?: { idleTimeoutMs: number; maxDurationMs: number },
  signal?: AbortSignal,
): Promise<AsyncIterable<Record<string, unknown>>> => {
  if (!ai.models.generateContentStream) {
    throw new GatewayError(501, 'NOT_IMPLEMENTED', 'Streaming is not implemented by the configured GenAI client.');
  }
  return ai.models.generateContentStream(
    buildGenerateRequest(route, body),
    {
      ...compatibilityMetadata(route, requestId, signal),
      ...(streamConfig ? { streamGuard: streamConfig } : {}),
    },
  );
};
