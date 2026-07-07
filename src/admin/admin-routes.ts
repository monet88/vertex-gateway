import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { GatewayConfig, VertexPoolConfig } from '../config/env.js';
import { createDerivedConfig } from '../config/env.js';
import { GatewayError, sendJson } from '../http/error-response.js';
import type { GenAiRuntimeLike } from '../lib/genai-runtime.js';
import { readJsonBody } from '../lib/read-json.js';
import { requireAdminAuth } from './admin-auth.js';
import { renderAdminSpa, serveAdminAsset } from './admin-spa.js';
import {
  createApiKeyVertexCredential,
  createCredentialStore,
  importServiceAccountCredential,
  type AdminCredentialStoreSnapshot,
  type AdminVertexCredentialRecord,
} from './credential-store.js';
import type { GenAiTargetHealth } from '../lib/genai-pool.js';
import { getProviderModelCatalog } from './model-store.js';
import { createGatewayKeyStore, verifyManagedGatewayKey } from './gateway-key-store.js';
import {
  canBootstrapAdminToken,
  persistAdminFileStoreSettings,
  readAdminFileStoreSettings,
} from '../config/admin-settings-store.js';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  MIN_ADMIN_PASSWORD_LENGTH,
  hashAdminPassword,
  isValidNewAdminPassword,
  verifyAdminPassword,
} from './admin-password.js';

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

const createAdminSessionToken = (): string => `adm_${randomBytes(32).toString('base64url')}`;

const configuredAdminUsername = (config: GatewayConfig): string => {
  const settings = readAdminFileStoreSettings(config);
  return typeof settings.adminUsername === 'string' && settings.adminUsername.trim()
    ? settings.adminUsername.trim()
    : DEFAULT_ADMIN_USERNAME;
};

const isPasswordStoreWritable = (config: GatewayConfig): boolean =>
  config.adminStoreMode === 'file-store'
  && config.adminAllowMutations
  && Boolean(config.adminFileStoreDir);

const assertPasswordStoreWritable = (config: GatewayConfig): void => {
  if (!isPasswordStoreWritable(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Admin password store is not writable.');
  }
};

const activateAdminToken = (
  config: GatewayConfig,
  adminToken: string,
  runtime?: GenAiRuntimeLike,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): void => {
  const nextConfig = createDerivedConfig(config, { adminToken });
  onConfigReload?.(nextConfig);
  if (!onConfigReload) runtime?.reload(nextConfig);
};

const verifyAdminPasswordLogin = async (
  config: GatewayConfig,
  username: string,
  password: string,
): Promise<{ username: string; mustChangePassword: boolean } | null> => {
  const settings = readAdminFileStoreSettings(config);
  const expectedUsername = typeof settings.adminUsername === 'string' && settings.adminUsername.trim()
    ? settings.adminUsername.trim()
    : DEFAULT_ADMIN_USERNAME;
  if (username !== expectedUsername) return null;

  const passwordHash = typeof settings.adminPasswordHash === 'string' ? settings.adminPasswordHash : '';
  if (passwordHash) {
    return await verifyAdminPassword(password, passwordHash)
      ? { username: expectedUsername, mustChangePassword: false }
      : null;
  }
  if (password === DEFAULT_ADMIN_PASSWORD) {
    return { username: expectedUsername, mustChangePassword: true };
  }
  return null;
};

const isAdminPasswordChangeRequired = (config: GatewayConfig): boolean => {
  if (config.adminStoreMode !== 'file-store' || !config.adminFileStoreDir) return false;
  const settings = readAdminFileStoreSettings(config);
  const configuredToken = typeof config.adminToken === 'string' && config.adminToken.trim();
  const staticToken = typeof settings.adminToken === 'string' && settings.adminToken.trim();
  const sessionToken = typeof settings.adminSessionToken === 'string' && settings.adminSessionToken.trim();
  return Boolean(configuredToken || staticToken || sessionToken) && !settings.adminPasswordHash;
};

const ensureAdminSessionToken = (
  config: GatewayConfig,
  runtime?: GenAiRuntimeLike,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): string => {
  if (config.adminToken) return config.adminToken;
  const settings = readAdminFileStoreSettings(config);
  const existingSessionToken = typeof settings.adminSessionToken === 'string'
    ? settings.adminSessionToken.trim()
    : '';
  if (existingSessionToken) {
    activateAdminToken(config, existingSessionToken, runtime, onConfigReload);
    return existingSessionToken;
  }
  if (!canBootstrapAdminToken(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Admin session token bootstrap is not available.');
  }
  const adminSessionToken = createAdminSessionToken();
  persistAdminFileStoreSettings(config, { adminSessionToken });
  activateAdminToken(config, adminSessionToken, runtime, onConfigReload);
  return adminSessionToken;
};

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

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (req.method === 'GET' && serveAdminAsset(normalizedPathname, res)) {
    return true;
  }

  if (req.method === 'GET' && normalizedPathname === '/admin') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(await renderAdminSpa());
    return true;
  }

  if (!normalizedPathname.startsWith('/admin/api/')) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin route is not implemented.');
  }

  if (req.method === 'POST' && normalizedPathname === '/admin/api/bootstrap/admin-token') {
    if (!canBootstrapAdminToken(config)) {
      throw new GatewayError(409, 'VALIDATION_FAILED', 'Admin token bootstrap is not available.');
    }
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const adminToken = typeof body.adminToken === 'string' ? body.adminToken.trim() : '';
    if (adminToken.length < 12) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'adminToken must be at least 12 characters.');
    }
    if (config.gatewayKeys.includes(adminToken)) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'adminToken must not overlap with gateway keys.');
    }
    if (verifyManagedGatewayKey(adminToken, config.managedGatewayKeyHashes)) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'adminToken must not overlap with managed gateway keys.');
    }
    persistAdminFileStoreSettings(config, { adminToken });
    const nextConfig = createDerivedConfig(config, { adminToken });
    onConfigReload?.(nextConfig);
    if (!onConfigReload) runtime?.reload(nextConfig);
    sendJson(res, 200, { ok: true, hasAdminToken: true });
    return true;
  }

  if (req.method === 'POST' && normalizedPathname === '/admin/api/auth/login') {
    assertPasswordStoreWritable(config);
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const login = await verifyAdminPasswordLogin(config, username, password);
    if (!login) {
      throw new GatewayError(401, 'AUTH_INVALID', 'Admin login failed.');
    }
    const token = ensureAdminSessionToken(config, runtime, onConfigReload);
    sendJson(res, 200, {
      ok: true,
      username: login.username,
      token,
      mustChangePassword: login.mustChangePassword,
    });
    return true;
  }

  requireAdminAuth(req.headers, config);

  if (req.method === 'POST' && normalizedPathname === '/admin/api/auth/change-password') {
    assertPasswordStoreWritable(config);
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const username = configuredAdminUsername(config);
    if (!await verifyAdminPasswordLogin(config, username, currentPassword)) {
      throw new GatewayError(401, 'AUTH_INVALID', 'Current admin password is invalid.');
    }
    if (!isValidNewAdminPassword(newPassword)) {
      throw new GatewayError(
        400,
        'VALIDATION_FAILED',
        `newPassword must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters and must not be the default password.`,
      );
    }
    const settings = readAdminFileStoreSettings(config);
    const sessionToken = typeof settings.adminSessionToken === 'string'
      ? settings.adminSessionToken.trim()
      : '';
    const shouldRotateSessionToken = !config.adminToken || (sessionToken && config.adminToken === sessionToken);
    const nextToken = shouldRotateSessionToken ? createAdminSessionToken() : config.adminToken;
    persistAdminFileStoreSettings(config, {
      adminUsername: username,
      adminPasswordHash: await hashAdminPassword(newPassword),
      adminPasswordChangedAt: new Date().toISOString(),
      ...(shouldRotateSessionToken ? { adminSessionToken: nextToken } : {}),
    });
    if (nextToken && nextToken !== config.adminToken) {
      activateAdminToken(config, nextToken, runtime, onConfigReload);
    }
    sendJson(res, 200, { ok: true, username, token: nextToken });
    return true;
  }

  if (isAdminPasswordChangeRequired(config)) {
    throw new GatewayError(403, 'AUTH_INVALID', 'Admin password change is required.');
  }

  if (!runtime) {
    throw new GatewayError(500, 'INTERNAL', 'Admin runtime is unavailable.');
  }

  const credentialStore = createCredentialStore(config, (nextConfig) => {
    onConfigReload?.(nextConfig);
    if (!onConfigReload) runtime.reload(nextConfig);
  });
  const gatewayKeyStore = createGatewayKeyStore(config, (nextConfig) => {
    onConfigReload?.(nextConfig);
    if (!onConfigReload) runtime.reload(nextConfig);
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
    const snapshot = credentialStore.updateVertexPools((state) => {
      if (state.vertexPools.some((entry) => entry.id === credential.id)) {
        throw new GatewayError(400, 'VALIDATION_FAILED', `Credential ${credential.id} already exists.`);
      }
      return {
        ...state,
        vertexPools: [...state.vertexPools, credential],
      };
    });
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
