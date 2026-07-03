import type { GatewayConfig } from '../config/env.js';
import { getGoogleAuthStatus } from '../auth/google-auth.js';
import type { GenAiRuntimeSnapshotView } from '../lib/genai-runtime.js';

export const rootResponse = () => ({
  endpoints: [
    'GET /',
    'GET /readyz',
    'GET /gemini/v1beta/models',
    'POST /gemini/v1beta/models/{model}:generateContent',
    'POST /gemini/v1beta/models/{model}:streamGenerateContent',
    'GET /openai/v1/models',
    'POST /openai/v1/chat/completions',
    'POST /openai/v1/responses',
    'POST /openai/v1/images/generations',
    'POST /openai/v1/images/edits',
    'POST /vertex/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent',
    'POST /vertex/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent',
  ],
  message: 'Chang Store Vertex Gateway',
});

export const healthResponse = () => ({
  ok: true,
  service: 'chang-store-vertex-gateway',
  uptimeSeconds: Math.round(process.uptime()),
});

export const readyResponse = (config: GatewayConfig, runtimeSnapshot?: GenAiRuntimeSnapshotView) => ({
  ok: true,
  service: 'chang-store-vertex-gateway',
  google: getGoogleAuthStatus(config),
  runtime: {
    mode: config.runtimeMode,
    selection: config.vertexPoolSelection,
    configuredTargets: config.vertexPools.length,
    enabledTargets: config.resolvedVertexTargets.length,
    healthyTargets: runtimeSnapshot?.active.healthyTargets ?? config.resolvedVertexTargets.length,
    cooldownTargets: runtimeSnapshot?.active.cooldownTargets ?? 0,
  },
  limits: {
    maxJsonBytes: config.maxJsonBytes,
    maxImages: config.maxImages,
    maxDecodedImageBytes: config.maxDecodedImageBytes,
    upstreamTimeoutMs: config.upstreamTimeoutMs,
    upstreamConcurrency: config.upstreamConcurrency,
    streamMaxDurationMs: config.streamMaxDurationMs,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    streamPerKeyLimit: config.streamPerKeyLimit,
    streamQueueLimit: config.streamQueueLimit,
    upstreamRetries: config.upstreamRetries,
    upstreamRetryDelayMs: config.upstreamRetryDelayMs,
  },
  routes: {
    wildcardCors: config.allowWildcardCors,
    gemini: config.enableGeminiRoutes,
    openai: config.enableOpenAiRoutes,
    vertex: config.enableVertexRoutes,
    vtx: config.enableVtxRoutes,
    images: config.enableImageRoutes,
  },
});
