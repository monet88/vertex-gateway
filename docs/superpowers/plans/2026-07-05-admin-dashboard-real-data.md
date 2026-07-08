# Admin Dashboard Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock Vertex target and gateway-key dashboard data with real admin API data while keeping gateway keys hash-only at rest.

**Architecture:** Backend adds a focused gateway-key store and admin routes beside the existing credential store. Runtime auth accepts config plaintext keys plus managed active key hashes through a hydrated active config. Frontend adds typed admin API functions and a dashboard hook that maps backend records into existing table row shapes.

**Tech Stack:** Node.js 22, TypeScript, Vitest, React 19, Vite 8, oxlint, shadcn/ui-style components.

---

## File Structure

- Create `src/admin/gateway-key-store.ts`: gateway-key record types, hash/preview helpers, file-store/static-config snapshots, create/revoke operations, active hash extraction.
- Modify `src/config/env.ts`: add `managedGatewayKeyHashes: string[]` to `GatewayConfig` and `createDerivedConfig` override support.
- Modify `test/test-config.ts`: default `managedGatewayKeyHashes: []`.
- Modify `src/auth/gateway-auth.ts`: compare candidate against plaintext config keys and managed hashes.
- Modify `src/app.ts`: hydrate managed hashes at startup and let admin mutations refresh active config.
- Modify `src/admin/admin-routes.ts`: add `/admin/api/gateway-keys` list/create/revoke routes and pass managed hash reload to app.
- Modify `test/admin-routes.test.ts`: cover API create/list/revoke/read-only/no-secret-leak behavior.
- Modify `test/auth.test.ts`: cover managed hash accept/revoked reject behavior.
- Create `frontend/src/lib/admin-dashboard-api.ts`: typed responses, mappers, load/create/revoke functions.
- Create `frontend/src/hooks/useAdminDashboardData.ts`: load state, refresh, create key, revoke key, create target.
- Modify `frontend/src/data/mockData.ts`: keep shared row types/static mock data for out-of-scope logs/KPIs/security notices; remove live target/key imports from Dashboard.
- Modify `frontend/src/components/console/GatewayKeyDialog.tsx`: async submit, pending/error states, one-time secret reveal.
- Modify `frontend/src/components/console/GatewayKeysTable.tsx`: add optional revoke action/loading state.
- Modify `frontend/src/components/console/VertexTargetDialog.tsx`: submit real API-key target draft.
- Modify `frontend/src/pages/Dashboard.tsx`: use live hook for keys/targets and keep logs/KPIs/static notices unchanged.

### Task 1: Gateway Key Store

**Files:**
- Create: `src/admin/gateway-key-store.ts`
- Test: `test/gateway-key-store.test.ts`
- Modify: `src/config/env.ts`
- Modify: `test/test-config.ts`

- [ ] **Step 1: Write failing store tests**

Create `test/gateway-key-store.test.ts` with these cases:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGatewayKeyStore, verifyManagedGatewayKey } from '../src/admin/gateway-key-store.js';
import { testConfig } from './test-config.js';
```
```ts
const tempStoreConfig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-keys-'));
  return testConfig({
    enableAdminRoutes: true,
    adminToken: 'admin-secret',
    adminAllowMutations: true,
    adminStoreMode: 'file-store',
    adminFileStoreDir: dir,
  });
};

describe('gateway key store', () => {
  it('creates a managed key, returns the secret once, and stores only a hash', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config);
    const created = store.create({ label: 'Mobile app' });
    expect(created.secret).toMatch(/^vgw_/);
    expect(created.gatewayKey.label).toBe('Mobile app');
    expect(created.gatewayKey.preview).toContain('vgw_');
    expect(JSON.stringify(store.getSnapshot())).not.toContain(created.secret);
    expect(verifyManagedGatewayKey(created.secret, store.getActiveHashes())).toBe(true);
  });
```

Continue the same file with revoke/read-only tests:

```ts
  it('revokes a managed key without deleting its metadata', () => {
    const config = tempStoreConfig();
    const store = createGatewayKeyStore(config);
    const created = store.create({ label: 'CLI smoke' });
    const revoked = store.revoke(created.gatewayKey.id);
    expect(revoked.gatewayKey.status).toBe('revoked');
    expect(verifyManagedGatewayKey(created.secret, store.getActiveHashes())).toBe(false);
  });
```

```ts
  it('lists static config keys as read-only sanitized previews', () => {
    const store = createGatewayKeyStore(testConfig({ gatewayKeys: ['test-key', 'second-key'] }));
    const snapshot = store.getSnapshot();
    expect(snapshot.mode).toBe('static-config');
    expect(snapshot.mutable).toBe(false);
    expect(snapshot.gatewayKeys).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain('second-key');
  });

  it('rejects create in static-config mode', () => {
    const store = createGatewayKeyStore(testConfig());
    expect(() => store.create({ label: 'Blocked' })).toThrow(/read-only/i);
  });
});
```

- [ ] **Step 2: Run failing store tests**

Run: `npm test -- test/gateway-key-store.test.ts`

Expected: fail because `src/admin/gateway-key-store.ts` does not exist.

- [ ] **Step 3: Add config support for managed hashes**

Modify `src/config/env.ts`:

```ts
export interface GatewayConfig {
  port: number;
  gatewayKeys: string[];
  managedGatewayKeyHashes: string[];
  corsOrigins: string[];
```
In `loadConfig`, set `managedGatewayKeyHashes: []` unless derived config overrides it. In `createDerivedConfig`, preserve the current value and allow an override:

```ts
managedGatewayKeyHashes: overlay.managedGatewayKeyHashes ?? base.managedGatewayKeyHashes,
```

Modify `test/test-config.ts`:

```ts
managedGatewayKeyHashes: [],
```

- [ ] **Step 4: Implement `gateway-key-store.ts`**

Create `src/admin/gateway-key-store.ts` with this public shape:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

export type GatewayKeyStatus = 'active' | 'revoked';

export interface AdminGatewayKeyRecord {
  id: string;
  label: string;
  preview: string;
  status: GatewayKeyStatus;
  createdAt: string;
  revokedAt?: string;
  hash: string;
}
```

Add sanitized response types and helpers:

```ts
export type SanitizedGatewayKeyRecord = Omit<AdminGatewayKeyRecord, 'hash'>;
export interface GatewayKeySnapshot { mode: GatewayConfig['adminStoreMode']; mutable: boolean; gatewayKeys: SanitizedGatewayKeyRecord[]; }
export interface CreatedGatewayKey { gatewayKey: SanitizedGatewayKeyRecord; secret: string; }
export interface RevokedGatewayKey { gatewayKey: SanitizedGatewayKeyRecord; }
```

Implement these functions:

```ts
const STORE_FILE = 'gateway-keys.json';
export const hashGatewayKey = (secret: string): string => createHash('sha256').update(secret).digest('hex');
const createSecret = (): string => `vgw_${randomBytes(24).toString('base64url')}`;
const previewSecret = (secret: string): string => `${secret.slice(0, 8)}...${secret.slice(-4)}`;
const sanitize = ({ hash: _hash, ...record }: AdminGatewayKeyRecord): SanitizedGatewayKeyRecord => record;

export const verifyManagedGatewayKey = (candidate: string, hashes: readonly string[]): boolean => {
  const candidateHash = Buffer.from(hashGatewayKey(candidate), 'hex');
  return hashes.some((hash) => timingSafeEqual(candidateHash, Buffer.from(hash, 'hex')));
};
```

Expose `createGatewayKeyStore(config)` with methods:

```ts
export interface GatewayKeyStore {
  getSnapshot(): GatewayKeySnapshot;
  getActiveHashes(): string[];
  create(input: { label?: string }): CreatedGatewayKey;
  revoke(id: string): RevokedGatewayKey;
}
```

Use `adminFileStoreDir/gateway-keys.json` for file-store persistence. Write atomically via `<file>.tmp` then rename, matching `credential-store.ts`.

- [ ] **Step 5: Run store tests and compile**

Run: `npm test -- test/gateway-key-store.test.ts`

Expected: pass.

Run: `npm run compile`

Expected: TypeScript compile succeeds.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/admin/gateway-key-store.ts src/config/env.ts test/test-config.ts test/gateway-key-store.test.ts
git commit -m "feat: add managed gateway key store"
```

### Task 2: Admin Gateway-Key Routes

**Files:**
- Modify: `src/admin/admin-routes.ts`
- Modify: `src/app.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing admin route tests**

Append a new case to `test/admin-routes.test.ts` inside `describe('admin routes', ...)`:

```ts
  it('creates, lists, and revokes managed gateway keys without leaking secrets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminToken: 'admin-secret',
        adminAllowMutations: true,
        adminStoreMode: 'file-store',
        adminFileStoreDir: dir,
      }),
      runtimeFactory: () => runtime,
    });
    const baseUrl = await listen(server);
    const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };
```

Continue with create/list assertions:

```ts
    const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'Mobile app' }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(200);
    expect(createdBody.secret).toMatch(/^vgw_/);
    expect(createdBody.gatewayKey.label).toBe('Mobile app');
    expect(createdBody.gatewayKey.hash).toBeUndefined();
```
```ts
    const secret = createdBody.secret as string;
    const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.gatewayKeys).toHaveLength(1);
    expect(JSON.stringify(listBody)).not.toContain(secret);
    expect(JSON.stringify(fs.readFileSync(path.join(dir, 'gateway-keys.json'), 'utf8'))).not.toContain(secret);
    expect(runtime.reload).toHaveBeenCalled();
```

Finish with revoke assertions:

```ts
    const id = listBody.gatewayKeys[0].id as string;
    const revoked = await fetch(`${baseUrl}/admin/api/gateway-keys/${id}/revoke`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret' },
    });
    const revokedBody = await revoked.json();
    expect(revoked.status).toBe(200);
    expect(revokedBody.gatewayKey.status).toBe('revoked');

    const rejected = await fetch(`${baseUrl}/v1/models`, { headers: { authorization: `Bearer ${secret}` } });
    expect(rejected.status).toBe(401);
  });
```

Add read-only route coverage:

```ts
  it('lists static config gateway keys but rejects managed key mutations in read-only mode', async () => {
    server = createApp({
      config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
      runtimeFactory: () => createFakeRuntime(),
    });
```ts
    const baseUrl = await listen(server);
    const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      headers: { authorization: 'Bearer admin-secret' },
    });
    const listBody = await list.json();
    expect(list.status).toBe(200);
    expect(listBody.mutable).toBe(false);
    expect(JSON.stringify(listBody)).not.toContain('test-key');

    const create = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Blocked' }),
    });
    expect(create.status).toBe(400);
  });
```

- [ ] **Step 2: Run failing admin route tests**

Run: `npm test -- test/admin-routes.test.ts`

Expected: fail with 404 for `/admin/api/gateway-keys`.

- [ ] **Step 3: Modify `src/app.ts` to keep an active config**

Change `createApp` so it hydrates managed hashes and passes a reload callback to admin routes:

```ts
import { hydrateManagedGatewayKeyHashes } from './admin/gateway-key-store.js';

export const createApp = ({ config, genAiFactory = createGoogleGenAiClient, runtimeFactory }: AppOptions) => {
  let activeConfig = hydrateManagedGatewayKeyHashes(config);
  const runtime = runtimeFactory
    ? runtimeFactory(activeConfig)
    : (genAiFactory === createGoogleGenAiClient ? createGenAiRuntime(activeConfig) : null);
```
Inside the request handler, pass `activeConfig` everywhere config is currently used for admin/public routing, auth, CORS, and model resolution. Keep `workloads` unchanged for this slice unless TypeScript forces a narrower change.

```ts
const reloadActiveConfig = (nextConfig: GatewayConfig) => {
  activeConfig = hydrateManagedGatewayKeyHashes(nextConfig);
  runtime?.reload(activeConfig);
};

if (await maybeHandleAdminRoute(req, res, url, activeConfig, runtime ?? undefined, reloadActiveConfig)) {
  return;
}
```

- [ ] **Step 4: Modify `src/admin/admin-routes.ts` signature and route handlers**

Update signature:

```ts
export const maybeHandleAdminRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: GatewayConfig,
  runtime?: GenAiRuntimeLike,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): Promise<boolean> => {
```

Import gateway-key helpers:

```ts
import { createGatewayKeyStore } from './gateway-key-store.js';
```

Create stores after runtime check:

```ts
const credentialStore = createCredentialStore(config, (nextConfig) => {
  onConfigReload?.(nextConfig);
  if (!onConfigReload) runtime.reload(nextConfig);
});
const gatewayKeyStore = createGatewayKeyStore(config, (nextConfig) => {
  onConfigReload?.(nextConfig);
});
```
Replace existing `store` references with `credentialStore` in credential/model routes.

Add routes before credential-specific regex handling:

```ts
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
```

Add revoke route:

```ts
const gatewayKeyRevokeMatch = normalizedPathname.match(/^\/admin\/api\/gateway-keys\/([^/]+)\/revoke$/);
if (gatewayKeyRevokeMatch && req.method === 'POST') {
  const id = decodeURIComponent(gatewayKeyRevokeMatch[1]);
  const revoked = gatewayKeyStore.revoke(id);
  sendJson(res, 200, { ok: true, ...revoked });
  return true;
}
```

- [ ] **Step 5: Run admin route tests**

Run: `npm test -- test/admin-routes.test.ts`

Expected: pass.

Run: `npm run compile`

Expected: pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/app.ts src/admin/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: expose managed gateway key admin routes"
```
### Task 3: Gateway Auth Managed Hash Support

**Files:**
- Modify: `src/auth/gateway-auth.ts`
- Modify: `test/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

Modify `test/auth.test.ts` imports:

```ts
import { hashGatewayKey } from '../src/admin/gateway-key-store.js';
```

Append tests:

```ts
  it('accepts active managed gateway key hashes', () => {
    const managedSecret = 'vgw_test-managed-secret';
    const config = testConfig({
      gatewayKeys: [],
      managedGatewayKeyHashes: [hashGatewayKey(managedSecret)],
    });
    expect(() => requireGatewayAuth(requestWithHeaders({ authorization: `Bearer ${managedSecret}` }), config)).not.toThrow();
  });

  it('rejects revoked managed keys when their hashes are not active', () => {
    const config = testConfig({ gatewayKeys: [], managedGatewayKeyHashes: [] });
    expect(() => requireGatewayAuth(requestWithHeaders({ authorization: 'Bearer vgw_revoked' }), config)).toThrow(/invalid/);
  });
```

- [ ] **Step 2: Run failing auth tests**

Run: `npm test -- test/auth.test.ts`

Expected: fail because `requireGatewayAuth` only checks `config.gatewayKeys`.

- [ ] **Step 3: Modify `src/auth/gateway-auth.ts`**

Expose a hash comparison helper or import `verifyManagedGatewayKey`:

```ts
import { verifyManagedGatewayKey } from '../admin/gateway-key-store.js';
```

Change auth check:

```ts
const matchesConfigKey = config.gatewayKeys.some((key) => constantTimeEqual(candidate, key));
const matchesManagedKey = verifyManagedGatewayKey(candidate, config.managedGatewayKeyHashes);
if (!matchesConfigKey && !matchesManagedKey) {
  throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is invalid.');
}
```
- [ ] **Step 4: Run auth and admin tests**

Run: `npm test -- test/auth.test.ts test/admin-routes.test.ts test/gateway-key-store.test.ts`

Expected: pass.

Run: `npm run compile`

Expected: pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/auth/gateway-auth.ts test/auth.test.ts
git commit -m "fix: authenticate managed gateway keys"
```

### Task 4: Frontend Admin API Layer

**Files:**
- Create: `frontend/src/lib/admin-dashboard-api.ts`
- Modify: `frontend/src/data/mockData.ts`

- [ ] **Step 1: Create typed API/mappers**

Create `frontend/src/lib/admin-dashboard-api.ts`:

```ts
import { adminFetch, type AdminApiOptions } from './admin-api';
import type { GatewayKeyRow, VertexTargetRow } from '@/data/mockData';

export interface AdminGatewayKeyRecord extends GatewayKeyRow {
  readonly revokedAt?: string;
}
export interface GatewayKeysResponse {
  readonly mode: 'static-config' | 'file-store';
  readonly mutable: boolean;
  readonly gatewayKeys: AdminGatewayKeyRecord[];
}
```
Add Vertex credential response types:

```ts
interface AdminVertexCredentialRecord {
  readonly id: string;
  readonly label?: string;
  readonly project: string;
  readonly location: string;
  readonly credentialsFile: string | null;
  readonly hasApiKey: boolean;
  readonly apiKeyMode: 'full' | 'express';
  readonly health?: { status?: string };
}
interface VertexCredentialsResponse {
  readonly vertexPools: AdminVertexCredentialRecord[];
}
```

Add mappers:

```ts
const mapHealth = (record: AdminVertexCredentialRecord): VertexTargetRow['health'] => {
  if (record.health?.status === 'healthy') return 'ready';
  if (record.health?.status === 'cooldown') return 'degraded';
  if (record.health?.status === 'disabled') return 'failed';
  return 'ready';
};

export const mapVertexTarget = (record: AdminVertexCredentialRecord): VertexTargetRow => ({
  id: record.id,
  label: record.label ?? record.id,
  project: record.project,
  location: record.location,
  authType: record.hasApiKey ? 'Google Cloud API key' : 'Service Account JSON',
  apiKeyMode: record.apiKeyMode,
  health: mapHealth(record),
});
```
Add API functions:

```ts
export async function fetchGatewayKeys(options: AdminApiOptions): Promise<GatewayKeysResponse> {
  return adminFetch<GatewayKeysResponse>('/admin/api/gateway-keys', options);
}

export async function fetchVertexTargets(options: AdminApiOptions): Promise<VertexTargetRow[]> {
  const response = await adminFetch<VertexCredentialsResponse>('/admin/api/vertex-credentials', options);
  return response.vertexPools.map(mapVertexTarget);
}

export async function createGatewayKey(options: AdminApiOptions, label: string) {
  return adminFetch<{ ok: true; gatewayKey: AdminGatewayKeyRecord; secret: string }>('/admin/api/gateway-keys', options, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function revokeGatewayKey(options: AdminApiOptions, id: string) {
  return adminFetch<{ ok: true; gatewayKey: AdminGatewayKeyRecord }>(`/admin/api/gateway-keys/${encodeURIComponent(id)}/revoke`, options, {
    method: 'POST',
  });
}
```

- [ ] **Step 2: Keep mock types only where useful**

In `frontend/src/data/mockData.ts`, keep the exported `GatewayKeyRow` and `VertexTargetRow` interfaces. Do not delete static `apiLogs`, `kpiMetrics`, or `securityNotices` in this task.

- [ ] **Step 3: Run frontend build for API types**

Run: `cd frontend && npm run build`

Expected: pass.

- [ ] **Step 4: Commit Task 4**

```bash
git add frontend/src/lib/admin-dashboard-api.ts frontend/src/data/mockData.ts
git commit -m "feat: add typed admin dashboard API client"
```
### Task 5: Frontend Dashboard Wiring

**Files:**
- Create: `frontend/src/hooks/useAdminDashboardData.ts`
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/components/console/GatewayKeyDialog.tsx`
- Modify: `frontend/src/components/console/GatewayKeysTable.tsx`
- Modify: `frontend/src/components/console/VertexTargetDialog.tsx`

- [ ] **Step 1: Create dashboard data hook**

Create `frontend/src/hooks/useAdminDashboardData.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GatewayKeyRow, VertexTargetRow } from '@/data/mockData';
import { createGatewayKey, fetchGatewayKeys, fetchVertexTargets, revokeGatewayKey } from '@/lib/admin-dashboard-api';

interface AdminDashboardState {
  readonly gatewayKeys: readonly GatewayKeyRow[];
  readonly vertexTargets: readonly VertexTargetRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly mutable: boolean;
  readonly latestSecret: string | null;
}
```

Add hook body:

```ts
export function useAdminDashboardData(token: string) {
  const [state, setState] = useState<AdminDashboardState>({
    gatewayKeys: [],
    vertexTargets: [],
    loading: false,
    error: null,
    mutable: false,
    latestSecret: null,
  });
  const options = useMemo(() => ({ token }), [token]);
```
Add `refresh`:

```ts
  const refresh = useCallback(async () => {
    if (!token) {
      setState((current) => ({ ...current, gatewayKeys: [], vertexTargets: [], loading: false, error: null, mutable: false }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [keysResponse, targets] = await Promise.all([fetchGatewayKeys(options), fetchVertexTargets(options)]);
      setState((current) => ({
        ...current,
        gatewayKeys: keysResponse.gatewayKeys,
        vertexTargets: targets,
        mutable: keysResponse.mutable,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Admin API request failed' }));
    }
  }, [options, token]);
```

Add actions and return:

```ts
  useEffect(() => { void refresh(); }, [refresh]);

  const createKey = useCallback(async (label: string) => {
    const created = await createGatewayKey(options, label);
    setState((current) => ({ ...current, latestSecret: created.secret }));
    await refresh();
    return created.secret;
  }, [options, refresh]);

  const revokeKey = useCallback(async (id: string) => {
    await revokeGatewayKey(options, id);
    await refresh();
  }, [options, refresh]);

  return { ...state, refresh, createKey, revokeKey, clearLatestSecret: () => setState((current) => ({ ...current, latestSecret: null })) };
}
```
- [ ] **Step 2: Make `GatewayKeyDialog` async-aware**

Change props:

```ts
export interface GatewayKeyDialogProps {
  readonly onCreate: (label: string) => Promise<string>;
  readonly disabled?: boolean;
}
```

Add pending/error/secret state and submit behavior:

```ts
const [pending, setPending] = useState(false);
const [error, setError] = useState<string | null>(null);
const [secret, setSecret] = useState<string | null>(null);

async function submit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
  setPending(true);
  setError(null);
  try {
    const createdSecret = await onCreate(label.trim() || 'Managed key');
    setSecret(createdSecret);
    setLabel('');
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Failed to create key');
  } finally {
    setPending(false);
  }
}
```

Render the secret once inside the dialog:

```tsx
{secret ? <div className="rounded-md border border-border bg-muted p-3 font-mono text-sm break-all">{secret}</div> : null}
{error ? <p className="text-sm text-destructive">{error}</p> : null}
<Button type="submit" disabled={pending || disabled}>{pending ? 'Đang tạo...' : 'Tạo key'}</Button>
```

- [ ] **Step 3: Add revoke action to `GatewayKeysTable`**

Change props:

```ts
export interface GatewayKeysTableProps {
  readonly rows: readonly GatewayKeyRow[];
  readonly onRevoke?: (id: string) => void;
  readonly mutable?: boolean;
}
```
Add an Actions column and render a small destructive/outline button only for active mutable rows:

```tsx
<TableHead>Actions</TableHead>
...
<TableCell>
  {mutable && key.status === 'active' ? (
    <Button variant="outline" size="sm" onClick={() => onRevoke?.(key.id)}>Revoke</Button>
  ) : null}
</TableCell>
```

Increase empty-state `colSpan` from 4 to 5.

- [ ] **Step 4: Wire `Dashboard.tsx` to live data**

Change imports:

```ts
import { apiLogs } from '@/data/mockData';
import { securityNotices } from '@/data/admin-static';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
```

Use the hook:

```ts
const { token, setToken } = useAdminToken();
const adminData = useAdminDashboardData(token);
```

Update dialog/table props:

```tsx
<GatewayKeyDialog onCreate={adminData.createKey} disabled={!token || !adminData.mutable} />
<VertexTargetDialog onCreate={(target) => console.info('create vertex target', target.project)} />
...
{adminData.error ? <p className="text-sm text-destructive">{adminData.error}</p> : null}
{adminData.loading ? <p className="text-sm text-muted-foreground">Loading admin data...</p> : null}
<GatewayKeysTable rows={adminData.gatewayKeys} mutable={adminData.mutable} onRevoke={(id) => void adminData.revokeKey(id)} />
<VertexTargetsTable rows={adminData.vertexTargets} />
```

Keep `apiLogs` and `securityNotices` as-is. Do not reference a non-existent `kpiMetrics` export.
- [ ] **Step 5: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: pass.

Run: `cd frontend && npm run lint`

Expected: pass with 0 warnings and 0 errors.

- [ ] **Step 6: Commit Task 5**

```bash
git add frontend/src/hooks/useAdminDashboardData.ts frontend/src/pages/Dashboard.tsx frontend/src/components/console/GatewayKeyDialog.tsx frontend/src/components/console/GatewayKeysTable.tsx frontend/src/components/console/VertexTargetDialog.tsx
git commit -m "feat: wire dashboard to live admin data"
```

### Task 6: API-Key Vertex Target Creation

**Files:**
- Modify: `src/admin/credential-store.ts`
- Modify: `src/admin/admin-routes.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `frontend/src/lib/admin-dashboard-api.ts`
- Modify: `frontend/src/hooks/useAdminDashboardData.ts`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Write failing backend route test**

Append to `test/admin-routes.test.ts`:

```ts
  it('creates API-key Vertex targets without exposing raw upstream keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
    const runtime = createFakeRuntime();
    server = createApp({
      config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret', adminAllowMutations: true, adminStoreMode: 'file-store', adminFileStoreDir: dir, runtimeMode: 'pool', vertexPools: [], resolvedVertexTargets: [] }),
      runtimeFactory: () => runtime,
    });
```ts
    const baseUrl = await listen(server);
    const response = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Global key', project: 'project-a', location: 'global', apiKey: 'google-secret' }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.credential.hasApiKey).toBe(true);
    expect(JSON.stringify(body)).not.toContain('google-secret');

    const list = await fetch(`${baseUrl}/admin/api/vertex-credentials`, { headers: { authorization: 'Bearer admin-secret' } });
    const listBody = await list.json();
    expect(JSON.stringify(listBody)).not.toContain('google-secret');
    expect(runtime.reload).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Add API-key target creator to credential store**

In `src/admin/credential-store.ts`, export:

```ts
export const createApiKeyVertexCredential = (config: GatewayConfig, body: Record<string, unknown>): AdminVertexCredentialRecord => {
  assertWritableMode(config);
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!project || !location || !apiKey) throw new GatewayError(400, 'VALIDATION_FAILED', 'project, location, and apiKey are required.');
  const id = sanitizeCredentialId(`${project}-${location}-${body.label || 'api-key'}`);
```
```ts
  return {
    id,
    label: typeof body.label === 'string' ? body.label.trim() || undefined : undefined,
    project,
    location,
    credentialsFile: null,
    apiKey,
    apiKeyMode: 'full',
    enabled: body.enabled !== false,
    weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    modelAllowlist: [],
    modelExclusions: [],
  };
};
```

If duplicate IDs are possible, append a short random suffix inside this creator before returning.

- [ ] **Step 3: Add API-key create route**

In `src/admin/admin-routes.ts`, import `createApiKeyVertexCredential`. Add route near service-account import:

```ts
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
```

Because `withRuntimeHealth` uses `redactApiKey`, raw `apiKey` must not appear in the response.

- [ ] **Step 4: Run backend tests**

Run: `npm test -- test/admin-routes.test.ts`

Expected: pass.

Run: `npm run compile`

Expected: pass.
- [ ] **Step 5: Wire frontend target creation**

In `frontend/src/lib/admin-dashboard-api.ts`, add:

```ts
export interface VertexTargetDraftPayload { readonly label: string; readonly project: string; readonly location: string; readonly apiKey: string; }

export async function createVertexTarget(options: AdminApiOptions, draft: VertexTargetDraftPayload): Promise<VertexTargetRow> {
  const response = await adminFetch<{ ok: true; credential: AdminVertexCredentialRecord }>('/admin/api/vertex-credentials/api-key', options, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
  return mapVertexTarget(response.credential);
}
```

In `frontend/src/hooks/useAdminDashboardData.ts`, import `createVertexTarget` and add:

```ts
const createTarget = useCallback(async (draft: VertexTargetDraftPayload) => {
  await createVertexTarget(options, draft);
  await refresh();
}, [options, refresh]);
```

Return `createTarget` from the hook.

In `Dashboard.tsx`, replace the console handler:

```tsx
<VertexTargetDialog onCreate={(target) => adminData.createTarget(target)} />
```

- [ ] **Step 6: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: pass.

Run: `cd frontend && npm run lint`

Expected: pass.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/admin/credential-store.ts src/admin/admin-routes.ts test/admin-routes.test.ts frontend/src/lib/admin-dashboard-api.ts frontend/src/hooks/useAdminDashboardData.ts frontend/src/pages/Dashboard.tsx
git commit -m "feat: create api-key vertex targets from admin dashboard"
```
### Task 7: Full Validation And Cleanup

**Files:**
- Verify only; modify files only if validation finds a defect.

- [ ] **Step 1: Run focused backend tests**

Run: `npm test -- test/gateway-key-store.test.ts test/auth.test.ts test/admin-routes.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run full backend validation**

Run: `npm test`

Expected: full Vitest suite passes.

Run: `npm run compile`

Expected: TypeScript compile succeeds.

- [ ] **Step 3: Run frontend validation**

Run: `cd frontend && npm run build`

Expected: TypeScript project build and Vite production build succeed.

Run: `cd frontend && npm run lint`

Expected: oxlint exits with 0 errors and 0 warnings.

- [ ] **Step 4: Manual smoke test with a local server**

Start gateway in a file-store admin config that has `enableAdminRoutes=true`, `adminAllowMutations=true`, `adminStoreMode=file-store`, and `adminFileStoreDir` pointing at a temp directory.

Open `/admin`, enter the admin token, create a gateway key, copy the one-time secret, call a protected public route with that secret, revoke it, and confirm the same secret receives 401 afterward.

Create an API-key Vertex target from the dashboard and confirm the target appears in the Vertex targets table without showing the raw Google API key.

- [ ] **Step 5: Commit fixes if validation required edits**

```bash
git add <only-files-fixed-during-validation>
git commit -m "fix: complete admin dashboard real data validation"
```

Skip this commit if validation required no edits.

## Self-Review Checklist

- Spec coverage: Vertex targets list/create and gateway keys list/create/revoke are covered. Logs, KPI metrics, and security notices remain out of scope by design.
- Secret handling: managed gateway key plaintext appears only in the create response and transient frontend state; list/revoke/store use sanitized records.
- Backward compatibility: existing `config.gatewayKeys` continue to authenticate; managed keys add active hashes without removing config keys.
- Validation: backend focused tests, full backend tests, compile, frontend build, and frontend lint are included.
