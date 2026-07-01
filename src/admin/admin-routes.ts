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
  createCredentialStore,
  importServiceAccountCredential,
  type AdminCredentialStoreSnapshot,
} from './credential-store.js';
import { getProviderModelCatalog } from './model-store.js';

const parseJsonBody = async (
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> => readJsonBody<Record<string, unknown>>(req, maxBytes);

const findCredentialOrThrow = (snapshot: AdminCredentialStoreSnapshot, id: string) => {
  const entry = snapshot.vertexPools.find((item) => item.id === id);
  if (!entry) {
    throw new GatewayError(404, 'NOT_FOUND', 'Credential not found.');
  }
  return entry;
};

const withRuntimeHealth = (
  snapshot: AdminCredentialStoreSnapshot,
  runtime: GenAiRuntimeLike,
): AdminCredentialStoreSnapshot => {
  const healthById = new Map(
    runtime.getSnapshot().active.targets.map((target) => [target.id, target.health]),
  );
  return {
    ...snapshot,
    vertexPools: snapshot.vertexPools.map((entry) => ({
      ...entry,
      ...(healthById.get(entry.id) ? { health: healthById.get(entry.id) } : {}),
    })),
  } as AdminCredentialStoreSnapshot;
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

  const store = createCredentialStore(config, (nextConfig) => {
    runtime.reload(nextConfig);
  });

  if (req.method === 'GET' && normalizedPathname === '/admin/api/health') {
    sendJson(res, 200, buildHealthResponse(runtime, config));
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/health/pool') {
    sendJson(res, 200, buildHealthResponse(runtime, config));
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/vertex-credentials') {
    sendJson(res, 200, withRuntimeHealth(store.getSnapshot(), runtime));
    return true;
  }
  if (req.method === 'POST' && normalizedPathname === '/admin/api/vertex-credentials/import') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const imported = importServiceAccountCredential(config, body);
    try {
      const snapshot = store.updateVertexPools((state) => ({
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

  const credentialMatch = normalizedPathname.match(/^\/admin\/api\/vertex-credentials\/([^/]+)$/);
  const credentialTestMatch = normalizedPathname.match(/^\/admin\/api\/vertex-credentials\/([^/]+)\/test$/);
  if (credentialMatch) {
    const id = decodeURIComponent(credentialMatch[1]);
    if (req.method === 'GET') {
      sendJson(res, 200, findCredentialOrThrow(withRuntimeHealth(store.getSnapshot(), runtime), id));
      return true;
    }
    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req, config.maxJsonBytes);
      const snapshot = store.updateVertexPools((state) => ({
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
      const current = findCredentialOrThrow(store.getSnapshot(), id);
      const snapshot = store.updateVertexPools((state) => ({
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
    const entry = findCredentialOrThrow(store.getSnapshot(), id);
    const response = await runtime.probeTarget({ ...entry, source: 'pool' });
    sendJson(res, 200, { ok: true, id, response });
    return true;
  }
  if (req.method === 'GET' && normalizedPathname === '/admin/api/models') {
    const provider = url.searchParams.get('provider');
    if (!provider) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'provider query param is required.');
    }
    sendJson(res, 200, getProviderModelCatalog(store.getSnapshot().modelCatalog, provider));
    return true;
  }

  const modelMatch = normalizedPathname.match(/^\/admin\/api\/models\/([^/]+)$/);
  if (modelMatch && req.method === 'PUT') {
    const provider = decodeURIComponent(modelMatch[1]);
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const snapshot = store.updateVertexPools((state) => ({
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
    const snapshot = store.getSnapshot();
    runtime.reload(createDerivedConfig(config, {
      vertexPools: snapshot.vertexPools.map(({ email: _email, ...entry }) => entry),
      modelCatalog: snapshot.modelCatalog,
    }));
    sendJson(res, 200, { ok: true, runtime: runtime.getSnapshot() });
    return true;
  }

  throw new GatewayError(404, 'NOT_FOUND', 'Admin route is not implemented.');
};
