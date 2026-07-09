import { createHash } from 'node:crypto';
import type { GatewayConfig } from '../src/config/env.js';

const digestKeys = (keys: readonly string[]): Buffer[] =>
  keys.map((key) => createHash('sha256').update(key).digest());

export const testConfig = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => {
  const {
    gatewayKeys: overrideKeys,
    gatewayKeyDigests: overrideDigests,
    ...rest
  } = overrides;
  const gatewayKeys = overrideKeys ? [...overrideKeys] : ['test-key'];
  return {
    port: 0,
    gatewayKeys,
    corsOrigins: ['http://localhost:3000'],
    allowWildcardCors: false,
    googleProject: 'test-project',
    googleLocation: 'us-central1',
    googleCredentialsFile: null,
    googleApiKey: null,
    googleApiVersion: 'v1',
    maxJsonBytes: 1024 * 1024,
    maxImages: 4,
    maxDecodedImageBytes: 1024 * 1024,
    upstreamTimeoutMs: 1000,
    upstreamConcurrency: 2,
    streamMaxDurationMs: 10_000,
    streamIdleTimeoutMs: 250,
    streamPerKeyLimit: 2,
    streamQueueLimit: 2,
    vertexPoolFailoverCooldownMs: 60_000,
    upstreamRetries: 2,
    upstreamRetryDelayMs: 250,
    enableGeminiRoutes: true,
    enableOpenAiRoutes: true,
    runtimeMode: 'single',
    vertexPoolSelection: 'round-robin',
    vertexPools: [],
    resolvedVertexTargets: [{
      id: 'legacy-default',
      label: 'Legacy default',
      project: 'test-project',
      location: 'us-central1',
      credentialsFile: null,
      apiKey: null,
      apiKeyMode: 'full',
      enabled: true,
      weight: 1,
      modelAllowlist: [],
      modelExclusions: [],
      source: 'legacy',
    }],
    modelCatalog: {},
    enableAdminRoutes: true,
    adminToken: null,
    adminAllowMutations: false,
    adminStoreMode: 'static-config',
    adminFileStoreDir: null,
    managedGatewayKeyHashes: [],
    gatewayKeyDigests: overrideDigests ?? digestKeys(gatewayKeys),
    ...rest,
    gatewayKeys,
    gatewayKeyDigests: overrideDigests ?? digestKeys(gatewayKeys),
  };
};
