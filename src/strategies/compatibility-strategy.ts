import type { ClassifiedRoute } from '../http/request-classifier.js';
import { GatewayError } from '../http/error-response.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import type { GenAiRequestMetadata } from '../lib/genai-request-metadata.js';

const instanceToContent = (instance: unknown): Record<string, unknown> => {
  if (typeof instance === 'string') {
    return { role: 'user', parts: [{ text: instance }] };
  }
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Vertex predict instances must be strings or objects.');
  }

  const value = instance as Record<string, unknown>;
  if (Array.isArray(value.parts)) {
    return { role: 'user', parts: value.parts };
  }
  if (value.content && typeof value.content === 'object' && !Array.isArray(value.content)) {
    const content = value.content as Record<string, unknown>;
    if (Array.isArray(content.parts)) {
      return { role: typeof content.role === 'string' ? content.role : 'user', parts: content.parts };
    }
  }

  const text = [value.prompt, value.text, value.input, value.content]
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  if (!text) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Vertex predict instances require prompt, text, input, content, or parts.');
  }
  return { role: 'user', parts: [{ text }] };
};

const buildGenerateRequest = (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
): Record<string, unknown> => ({ ...body, model: route.model });

const compatibilityMetadata = (
  route: ClassifiedRoute,
  requestId?: string,
): GenAiRequestMetadata => ({
  routeFamily: route.family === 'gemini' ? 'gemini' : 'vertex',
  ...(requestId ? { requestId } : {}),
});

const buildPredictRequest = (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
): Record<string, unknown> => {
  if (!Array.isArray(body.instances) || body.instances.length === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Vertex predict requires a non-empty instances array.');
  }
  return {
    model: route.model,
    contents: body.instances.map(instanceToContent),
    ...(body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
      ? { config: body.parameters }
      : {}),
  };
};

export const runCompatibilityRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
): Promise<Record<string, unknown>> => {
  if (route.operation === 'models') return { models: [] };
  if (route.operation === 'predict') {
    return ai.models.generateContent(
      buildPredictRequest(route, body),
      { routeFamily: 'vertex', ...(requestId ? { requestId } : {}) },
    );
  }
  return ai.models.generateContent(
    buildGenerateRequest(route, body),
    compatibilityMetadata(route, requestId),
  );
};

export const runCompatibilityStreamRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
  streamConfig?: { idleTimeoutMs: number; maxDurationMs: number },
): Promise<AsyncIterable<Record<string, unknown>>> => {
  if (!ai.models.generateContentStream) {
    throw new GatewayError(501, 'NOT_IMPLEMENTED', 'Streaming is not implemented by the configured GenAI client.');
  }
  return ai.models.generateContentStream(
    buildGenerateRequest(route, body),
    {
      ...compatibilityMetadata(route, requestId),
      ...(streamConfig ? { streamGuard: streamConfig } : {}),
    },
  );
};
