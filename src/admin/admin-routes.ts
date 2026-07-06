import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { GatewayConfig, VertexPoolConfig } from '../config/env.js';
import { createDerivedConfig } from '../config/env.js';
import { GatewayError, sendJson } from '../http/error-response.js';
import type { GenAiRuntimeLike } from '../lib/genai-runtime.js';
import { readJsonBody } from '../lib/read-json.js';
import { requireAdminAuth } from './admin-auth.js';
import { renderAdminUi } from './admin-ui.js';
import {
  createApiKeyVertexCredential,
  createCredentialStore,
  importServiceAccountCredential,
  type AdminCredentialStoreSnapshot,
  type AdminVertexCredentialRecord,
} from './credential-store.js';
import type { GenAiTargetHealth } from '../lib/genai-pool.js';
import { getProviderModelCatalog } from './model-store.js';
import { createGatewayKeyStore } from './gateway-key-store.js';

// Response-only shape: the raw express-mode `apiKey` is stripped and replaced
// with a boolean presence flag. Runtime health is attached for the admin UI.
type SanitizedCredentialRecord = Omit<AdminVertexCredentialRecord, 'apiKey'> & {
  hasApiKey: boolean;
  health?: GenAiTargetHealth;
};

interface SanitizedCredentialSnapshot extends Omit<AdminCredentialStoreSnapshot, 'vertexPools'> {
  vertexPools: SanitizedCredentialRecord[];
}

const parseJsonBody = async (
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> => readJsonBody<Record<string, unknown>>(req, maxBytes);

const findCredentialOrThrow = <T extends { id: string }>(
  snapshot: { vertexPools: T[] },
  id: string,
): T => {
  const entry = snapshot.vertexPools.find((item) => item.id === id);
  if (!entry) {
    throw new GatewayError(404, 'NOT_FOUND', 'Credential not found.');
  }
  return entry;
};

// Never expose the raw express-mode API key in admin responses. Mirror how
// service-account private keys are withheld (only client_email surfaces); expose
// a boolean presence flag so the UI can still show that express mode is active.
const redactApiKey = <T extends { apiKey?: string | null }>(entry: T): Omit<T, 'apiKey'> & { hasApiKey: boolean } => {
  const { apiKey: _apiKey, ...rest } = entry;
  return { ...rest, hasApiKey: Boolean(_apiKey) };
};

const withRuntimeHealth = (
  snapshot: AdminCredentialStoreSnapshot,
  runtime: GenAiRuntimeLike,
): SanitizedCredentialSnapshot => {
  const healthById = new Map(
    runtime.getSnapshot().active.targets.map((target) => [target.id, target.health]),
  );
  return {
    ...snapshot,
    vertexPools: snapshot.vertexPools.map((entry) => redactApiKey({
      ...entry,
      ...(healthById.get(entry.id) ? { health: healthById.get(entry.id) } : {}),
    })),
  };
};

const buildHealthResponse = (runtime: GenAiRuntimeLike, config: GatewayConfig) => ({
  ok: true,
  service: 'chang-store-vertex-gateway',
  runtime: runtime.getSnapshot(),
  mode: config.adminStoreMode,
});

const toPoolPatch = (
  current: VertexPoolConfig,
  body: Record<string, unknown>,
): VertexPoolConfig => ({
  ...current,
  ...(typeof body.label === 'string' ? { label: body.label.trim() || undefined } : {}),
  ...(typeof body.project === 'string' ? { project: body.project.trim() } : {}),
  ...(typeof body.location === 'string' ? { location: body.location.trim() } : {}),
  ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
  ...(typeof body.weight === 'number' && body.weight > 0 ? { weight: body.weight } : {}),
  ...(Array.isArray(body.modelAllowlist)
    ? { modelAllowlist: body.modelAllowlist.filter((value): value is string => typeof value === 'string') }
    : {}),
  ...(Array.isArray(body.modelExclusions)
    ? { modelExclusions: body.modelExclusions.filter((value): value is string => typeof value === 'string') }
    : {}),
});

export const maybeHandleAdminRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: GatewayConfig,
  runtime?: GenAiRuntimeLike,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): Promise<boolean> => {
  const normalizedPathname = url.pathname === '/' ? '/' : (url.pathname.replace(/\/+$/, '') || '/');
  if (!normalizedPathname.startsWith('/admin')) {
    return false;
  }
  if (!config.enableAdminRoutes) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin routes are disabled.');
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method === 'GET' && normalizedPathname === '/admin') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(renderAdminUi());
    return true;
  }

  if (!normalizedPathname.startsWith('/admin/api/')) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin route is not implemented.');
  }
  requireAdminAuth(req.headers, config);
  if (!runtime) {
    throw new GatewayError(500, 'INTERNAL', 'Admin runtime is unavailable.');
  }

  const credentialStore = createCredentialStore(config, (nextConfig) => {
    onConfigReload?.(nextConfig);
    if (!onConfigReload) runtime.reload(nextConfig);
  });
  const gatewayKeyStore = createGatewayKeyStore(config, (nextConfig) => {
    onConfigReload?.(nextConfig);
  });

  if (req.method === 'GET' && normalizedPathname === '/admin/api/health') {
    sendJson(res, 200, buildHealthResponse(runtime, config));
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/health/pool') {
    sendJson(res, 200, buildHealthResponse(runtime, config));
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/gateway-keys') {
    sendJson(res, 200, gatewayKeyStore.getSnapshot());
    return true;
  }
  if (req.method === 'POST' && normalizedPathname === '/admin/api/gateway-keys') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const created = gatewayKeyStore.create({ label: typeof body.label === 'string' ? body.label : undefined });
    sendJson(res, 200, { ok: true, ...created });
    return true;
  }
  const gatewayKeyRevokeMatch = normalizedPathname.match(/^\/admin\/api\/gateway-keys\/([^/]+)\/revoke$/);
  if (gatewayKeyRevokeMatch && req.method === 'POST') {
    const id = decodeURIComponent(gatewayKeyRevokeMatch[1]);
    const revoked = gatewayKeyStore.revoke(id);
    sendJson(res, 200, { ok: true, ...revoked });
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/vertex-credentials') {
    sendJson(res, 200, withRuntimeHealth(credentialStore.getSnapshot(), runtime));
    return true;
  }
  if (req.method === 'POST' && normalizedPathname === '/admin/api/vertex-credentials/import') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const imported = importServiceAccountCredential(config, body);
    try {
      const snapshot = credentialStore.updateVertexPools((state) => ({
        ...state,
        vertexPools: [...state.vertexPools.filter((entry) => entry.id !== imported.credential.id), imported.credential],
      }));
      sendJson(res, 200, {
        ok: true,
        credential: findCredentialOrThrow(withRuntimeHealth(snapshot, runtime), imported.credential.id),
      });
    } catch (error) {
      imported.rollback();
      throw error;
    }
    return true;
  }
  if (req.method === 'POST' && normalizedPathname === '/admin/api/vertex-credentials/api-key') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const credential = createApiKeyVertexCredential(config, body);
    const snapshot = credentialStore.updateVertexPools((state) => ({
      ...state,
      vertexPools: [...state.vertexPools.filter((entry) => entry.id !== credential.id), credential],
    }));
    sendJson(res, 200, { ok: true, credential: findCredentialOrThrow(withRuntimeHealth(snapshot, runtime), credential.id) });
    return true;
  }

  const credentialMatch = normalizedPathname.match(/^\/admin\/api\/vertex-credentials\/([^/]+)$/);
  const credentialTestMatch = normalizedPathname.match(/^\/admin\/api\/vertex-credentials\/([^/]+)\/test$/);
  if (credentialMatch) {
    const id = decodeURIComponent(credentialMatch[1]);
    if (req.method === 'GET') {
      sendJson(res, 200, findCredentialOrThrow(withRuntimeHealth(credentialStore.getSnapshot(), runtime), id));
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req, config.maxJsonBytes);
      const snapshot = credentialStore.updateVertexPools((state) => ({
        ...state,
        vertexPools: state.vertexPools.map((entry) => entry.id === id ? {
          ...toPoolPatch(entry, body),
          ...(entry.email ? { email: entry.email } : {}),
        } : entry),
      }));
      sendJson(res, 200, { ok: true, credential: findCredentialOrThrow(withRuntimeHealth(snapshot, runtime), id) });
      return true;
    }
    if (req.method === 'DELETE') {
      const current = findCredentialOrThrow(credentialStore.getSnapshot(), id);
      const snapshot = credentialStore.updateVertexPools((state) => ({
        ...state,
        vertexPools: state.vertexPools.filter((entry) => entry.id !== id),
      }));
      if (config.adminStoreMode === 'file-store' && current.credentialsFile) {
        try {
          await fs.unlink(current.credentialsFile);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
      sendJson(res, 200, { ok: true, remaining: snapshot.vertexPools.length });
      return true;
    }
  }
  if (credentialTestMatch && req.method === 'POST') {
    const id = decodeURIComponent(credentialTestMatch[1]);
    const entry = findCredentialOrThrow(credentialStore.getSnapshot(), id);
    const response = await runtime.probeTarget({ ...entry, source: 'pool' });
    sendJson(res, 200, { ok: true, id, response });
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/models') {
    const provider = url.searchParams.get('provider');
    if (!provider) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'provider query param is required.');
    }
    sendJson(res, 200, getProviderModelCatalog(credentialStore.getSnapshot().modelCatalog, provider));
    return true;
  }

  const modelMatch = normalizedPathname.match(/^\/admin\/api\/models\/([^/]+)$/);
  if (modelMatch && req.method === 'PUT') {
    const provider = decodeURIComponent(modelMatch[1]);
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const snapshot = credentialStore.updateVertexPools((state) => ({
      ...state,
      modelCatalog: {
        ...state.modelCatalog,
        [provider]: {
          ...(typeof body.defaultModel === 'string' ? { defaultModel: body.defaultModel } : {}),
          aliases: body.aliases && typeof body.aliases === 'object' && !Array.isArray(body.aliases)
            ? Object.fromEntries(Object.entries(body.aliases).filter(([, value]) => typeof value === 'string'))
            : {},
          allowlist: Array.isArray(body.allowlist)
            ? body.allowlist.filter((value): value is string => typeof value === 'string')
            : [],
          disabled: Array.isArray(body.disabled)
            ? body.disabled.filter((value): value is string => typeof value === 'string')
            : [],
        },
      },
    }));
    sendJson(res, 200, { ok: true, modelCatalog: snapshot.modelCatalog[provider] });
    return true;
  }

  if (req.method === 'POST' && normalizedPathname === '/admin/api/runtime/reload') {
    const snapshot = credentialStore.getSnapshot();
    runtime.reload(createDerivedConfig(config, {
      vertexPools: snapshot.vertexPools.map(({ email: _email, ...entry }) => entry),
      modelCatalog: snapshot.modelCatalog,
    }));
    sendJson(res, 200, { ok: true, runtime: runtime.getSnapshot() });
    return true;
  }

  throw new GatewayError(404, 'NOT_FOUND', 'Admin route is not implemented.');
};
