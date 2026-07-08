# Admin Dashboard Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal safe backend/admin surface for the Vertex Gateway dashboard: managed gateway API keys, admin security status, Vertex API-key targets, API call logs, and domain allow/block policy.

**Architecture:** Keep the current zero-framework `node:http` shape. Extend the existing admin API and file-store path instead of adding a database or frontend framework. Store new mutable admin state in the existing admin file-store when `adminStoreMode === 'file-store'`; keep env/static config read-only.

**Tech Stack:** Node.js 22, TypeScript ESM, Vitest, built-in `node:crypto`, `node:fs`, `node:http`. No new runtime dependencies.

---

## Scope check

The original dashboard idea contains several independent subsystems. This plan intentionally ships the smallest useful backend slice:

- Gateway key management with generated keys stored as SHA-256 hashes.
- Admin access status and conflict checks, not runtime admin password rotation.
- Vertex target management for Google Cloud API key mode plus the existing service-account flow.
- In-memory API call logs with safe redaction.
- Domain allowlist/blacklist for browser `Origin` handling.
- Minimal admin UI wording/style update to expose these APIs.

Out of scope for this plan:

- Persistent log database.
- Multi-user admin accounts.
- Role-based access control.
- Audit-log signing.
- Runtime admin token rotation from UI.
- External secret-manager integration.

Those are real features, but they do not need to exist for the first working dashboard.

---

## File structure

### Create

- `src/admin/gateway-key-store.ts` - Generates, hashes, redacts, and verifies managed gateway API keys.
- `src/admin/request-log-store.ts` - In-memory ring buffer for redacted API call logs.
- `src/lib/domain-policy.ts` - Exact and wildcard origin matching plus blocked-origin enforcement.
- `test/gateway-key-store.test.ts` - Unit tests for generated key behavior and redaction.
- `test/request-log-store.test.ts` - Unit tests for log ring buffer and redaction.
- `test/domain-policy.test.ts` - Unit tests for exact/wildcard origin matching.

### Modify

- `src/config/env.ts` - Add `GatewayKeyRecord`, `blockedOrigins`, and derived-config support.
- `src/admin/credential-store.ts` - Persist `gatewayKeys`, `corsOrigins`, `allowWildcardCors`, and `blockedOrigins` in the existing file-store.
- `src/auth/gateway-auth.ts` - Accept managed hashed gateway keys in addition to raw env keys.
- `src/app.ts` - Record API calls and enforce blocked browser origins.
- `src/admin/admin-routes.ts` - Add admin endpoints for gateway keys, logs, domain policy, security status, and API-key Vertex targets.
- `src/admin/admin-ui.ts` - Minimal operator-console UI copy/style update and client calls for new endpoints.
- `test/test-config.ts` - Add default values for new config fields.
- `test/admin-routes.test.ts` - Integration tests for new admin APIs.
- `test/auth.test.ts` - Auth tests for managed hashed gateway keys.
- `test/cors.test.ts` - Domain blacklist behavior tests.
- `test/admin-ui.test.ts` - UI shell assertions for new dashboard sections.
- `README.md` - Document admin dashboard backend controls.

---

## Task 1: Add managed gateway key primitives

**Files:**
- Create: `src/admin/gateway-key-store.ts`
- Test: `test/gateway-key-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/gateway-key-store.test.ts`:

```typescript
// Superseded design artifact: the shipped implementation centers the module on
// `createGatewayKeyStore()` and `verifyManagedGatewayKey()` rather than the
// standalone `createGatewayKeyRecord()` / `matchesGatewayKeyRecord()` helpers
// described in this draft.

describe('gateway key store helpers', () => {
  it('creates a managed key record without storing the raw key', () => {
    const created = createGatewayKeyRecord('Mobile app', '2026-07-05T00:00:00.000Z');

    expect(created.rawKey).toMatch(/^vgw_/);
    expect(created.record.label).toBe('Mobile app');
    expect(created.record.keyHash).toHaveLength(64);
    expect(created.record.keyPreview).toMatch(/^vgw_.*\*\*\*/);
    expect(JSON.stringify(created.record)).not.toContain(created.rawKey);
    expect(matchesGatewayKeyRecord(created.rawKey, created.record)).toBe(true);
    expect(matchesGatewayKeyRecord('wrong-key', created.record)).toBe(false);
  });

  it('redacts managed records and preserves revocation state', () => {
    const { record } = createGatewayKeyRecord('Browser client', '2026-07-05T00:00:00.000Z');
    const redacted = redactGatewayKeyRecord({
      ...record,
      enabled: false,
      revokedAt: '2026-07-06T00:00:00.000Z',
    });

    expect(redacted).toEqual({
      id: record.id,
      label: 'Browser client',
      keyPreview: record.keyPreview,
      enabled: false,
      createdAt: '2026-07-05T00:00:00.000Z',
      revokedAt: '2026-07-06T00:00:00.000Z',
      source: 'managed',
    });
    expect(JSON.stringify(redacted)).not.toContain(record.keyHash);
  });

  it('represents env keys as read-only records', () => {
    const record = createReadOnlyGatewayKeyRecord('test-key', 0);

    expect(record.source).toBe('env');
    expect(record.enabled).toBe(true);
    expect(record.id).toMatch(/^env-/);
    expect(record.keyPreview).toBe('test...key');
    expect(matchesGatewayKeyRecord('test-key', record)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- test/gateway-key-store.test.ts
```

Expected: FAIL with module not found for `../src/admin/gateway-key-store.js`.

- [ ] **Step 3: Implement the gateway key helpers**

Create `src/admin/gateway-key-store.ts`:

```typescript
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type GatewayKeySource = 'env' | 'managed';

export interface GatewayKeyRecord {
  id: string;
  label: string;
  keyHash: string;
  keyPreview: string;
  enabled: boolean;
  createdAt: string;
  revokedAt?: string | null;
  source: GatewayKeySource;
}

export type RedactedGatewayKeyRecord = Omit<GatewayKeyRecord, 'keyHash'>;

export interface CreatedGatewayKey {
  rawKey: string;
  record: GatewayKeyRecord;
}

const hashGatewayKey = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const previewGatewayKey = (value: string): string => {
  if (value.length <= 8) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
};

const safeHashEqual = (leftHex: string, rightHex: string): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(leftHex) || !/^[a-f0-9]{64}$/i.test(rightHex)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex'));
};

const labelOrDefault = (label: string, fallback: string): string => {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

export const createGatewayKeyRecord = (label: string, nowIso = new Date().toISOString()): CreatedGatewayKey => {
  const rawKey = `vgw_${randomBytes(32).toString('base64url')}`;
  const keyHash = hashGatewayKey(rawKey);
  return {
    rawKey,
    record: {
      id: `key-${keyHash.slice(0, 16)}`,
      label: labelOrDefault(label, 'Managed key'),
      keyHash,
      keyPreview: previewGatewayKey(rawKey),
      enabled: true,
      createdAt: nowIso,
      revokedAt: null,
      source: 'managed',
    },
  };
};

export const createReadOnlyGatewayKeyRecord = (rawKey: string, index: number): GatewayKeyRecord => {
  const keyHash = hashGatewayKey(rawKey);
  return {
    id: `env-${keyHash.slice(0, 16)}`,
    label: `ENV key ${index + 1}`,
    keyHash,
    keyPreview: previewGatewayKey(rawKey),
    enabled: true,
    createdAt: 'env',
    revokedAt: null,
    source: 'env',
  };
};

export const matchesGatewayKeyRecord = (candidate: string, record: GatewayKeyRecord): boolean => {
  if (!record.enabled || record.revokedAt) return false;
  return safeHashEqual(hashGatewayKey(candidate), record.keyHash);
};

export const redactGatewayKeyRecord = (record: GatewayKeyRecord): RedactedGatewayKeyRecord => {
  const { keyHash: _keyHash, ...redacted } = record;
  return redacted;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test -- test/gateway-key-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/gateway-key-store.ts test/gateway-key-store.test.ts
git commit -m "feat: add managed gateway key helpers"
```

---

## Task 2: Add config fields for managed keys and blocked origins

**Files:**
- Modify: `src/config/env.ts`
- Modify: `test/test-config.ts`
- Test: `test/env-config.test.ts`

- [ ] **Step 1: Write the failing env config test**

Append to `test/env-config.test.ts`:

```typescript
// Superseded design note: the shipped implementation does not add
// `gatewayKeyRecords` or `blockedOrigins` to `GatewayConfig`. Managed gateway
// state is persisted as `managedGatewayKeyHashes`, so this test should not be
// implemented as written.
```

If the existing `loadConfig` test helper uses a different signature, adapt only the `loadConfig` call to the existing helper style. Keep the same assertions.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm test -- test/env-config.test.ts -t "managed gateway keys"
```

Expected: FAIL because `gatewayKeyRecords` and `blockedOrigins` do not exist on `GatewayConfig`.

- [ ] **Step 3: Add config types and defaults**

Modify `src/config/env.ts`:

```typescript
export interface GatewayKeyRecord {
  id: string;
  label: string;
  keyHash: string;
  keyPreview: string;
  enabled: boolean;
  createdAt: string;
  revokedAt?: string | null;
  source: 'env' | 'managed';
}
```

Add to `GatewayConfig`:

```typescript
  gatewayKeyRecords: GatewayKeyRecord[];
  blockedOrigins: string[];
```

Add to `GatewayPoolOverlayConfig`:

```typescript
  gatewayKeyRecords: GatewayKeyRecord[];
  blockedOrigins: string[];
```

In the final `GatewayConfig` construction in `loadConfig`, add:

```typescript
    gatewayKeyRecords: Array.isArray(poolOverlay.gatewayKeyRecords)
      ? poolOverlay.gatewayKeyRecords.filter((entry): entry is GatewayKeyRecord => (
        Boolean(entry)
        && typeof entry.id === 'string'
        && typeof entry.label === 'string'
        && typeof entry.keyHash === 'string'
        && typeof entry.keyPreview === 'string'
        && typeof entry.enabled === 'boolean'
        && typeof entry.createdAt === 'string'
        && (entry.source === 'env' || entry.source === 'managed')
      ))
      : [],
    blockedOrigins: Array.isArray(poolOverlay.blockedOrigins)
      ? poolOverlay.blockedOrigins.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [],
```

In `createDerivedConfig`, include the overrides:

```typescript
    gatewayKeyRecords: overrides.gatewayKeyRecords ?? config.gatewayKeyRecords,
    corsOrigins: overrides.corsOrigins ?? config.corsOrigins,
    allowWildcardCors: overrides.allowWildcardCors ?? config.allowWildcardCors,
    blockedOrigins: overrides.blockedOrigins ?? config.blockedOrigins,
```

Add matching fields to the `createDerivedConfig` override type if it is an inline `Partial<...>`.

- [ ] **Step 4: Update test defaults**

Modify `test/test-config.ts`:

```typescript
  gatewayKeyRecords: [],
  blockedOrigins: [],
```

Place `gatewayKeyRecords` near `gatewayKeys` and `blockedOrigins` near `corsOrigins`.

- [ ] **Step 5: Run config tests**

Run:

```bash
npm test -- test/env-config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts test/test-config.ts test/env-config.test.ts
git commit -m "feat: load managed admin policy config"
```

---

## Task 3: Authenticate managed hashed gateway keys

**Files:**
- Modify: `src/auth/gateway-auth.ts`
- Test: `test/auth.test.ts`

- [ ] **Step 1: Write the failing auth test**

Append to `test/auth.test.ts`:

```typescript
it('accepts enabled managed gateway key records without storing raw keys', () => {
  const created = createGatewayKeyRecord('Managed client', '2026-07-05T00:00:00.000Z');
  const req = {
    headers: { authorization: `Bearer ${created.rawKey}` },
  } as IncomingMessage;

  expect(() => requireGatewayAuth(req, testConfig({
    gatewayKeys: [],
    gatewayKeyRecords: [created.record],
  }))).not.toThrow();
});

it('rejects revoked managed gateway key records', () => {
  const created = createGatewayKeyRecord('Revoked client', '2026-07-05T00:00:00.000Z');
  const req = {
    headers: { authorization: `Bearer ${created.rawKey}` },
  } as IncomingMessage;

  expect(() => requireGatewayAuth(req, testConfig({
    gatewayKeys: [],
    gatewayKeyRecords: [{
      ...created.record,
      enabled: false,
      revokedAt: '2026-07-06T00:00:00.000Z',
    }],
  }))).toThrow('Gateway API key is invalid.');
});
```

Add imports at the top of `test/auth.test.ts`:

```typescript
import type { IncomingMessage } from 'node:http';
import { createGatewayKeyRecord } from '../src/admin/gateway-key-store.js';
import { testConfig } from './test-config.js';
```

Keep existing imports and avoid duplicates.

- [ ] **Step 2: Run the auth tests to verify failure**

Run:

```bash
npm test -- test/auth.test.ts -t "managed gateway key"
```

Expected: FAIL because `requireGatewayAuth` only checks raw `gatewayKeys`.

- [ ] **Step 3: Update gateway auth**

Modify `src/auth/gateway-auth.ts`:

```typescript
import { matchesGatewayKeyRecord } from '../admin/gateway-key-store.js';
```

Change `requireGatewayAuth` to:

```typescript
export const requireGatewayAuth = (req: IncomingMessage, config: GatewayConfig): void => {
  const candidate = extractGatewayKey(req);
  if (!candidate) throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is required.');
  const matchesEnvKey = config.gatewayKeys.some((key) => constantTimeEqual(candidate, key));
  const matchesManagedKey = config.gatewayKeyRecords.some((record) => matchesGatewayKeyRecord(candidate, record));
  if (!matchesEnvKey && !matchesManagedKey) {
    throw new GatewayError(401, 'AUTH_INVALID', 'Gateway API key is invalid.');
  }
};
```

- [ ] **Step 4: Run auth tests**

Run:

```bash
npm test -- test/auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/gateway-auth.ts test/auth.test.ts
git commit -m "feat: authenticate managed gateway keys"
```

---

## Task 4: Persist gateway keys and domain policy in file-store

**Files:**
- Modify: `src/admin/credential-store.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Add failing persistence assertions**

In `test/admin-routes.test.ts`, add a new test near the file-store admin tests:

```typescript
it('persists managed gateway keys and domain policy in file-store snapshots', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
  const runtime = createFakeRuntime();
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: dir,
      gatewayKeys: [],
      gatewayKeyRecords: [],
      corsOrigins: ['https://old.example'],
      blockedOrigins: [],
    }),
    runtimeFactory: () => runtime,
  });
  const baseUrl = await listen(server);
  const headers = {
    authorization: 'Bearer admin-secret',
    'content-type': 'application/json',
  };

  const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ label: 'Dashboard client' }),
  });
  const createdBody = await created.json();
  expect(created.status).toBe(200);
  expect(createdBody.rawKey).toMatch(/^vgw_/);

  const patched = await fetch(`${baseUrl}/admin/api/domain-policy`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      corsOrigins: ['https://app.example'],
      allowWildcardCors: false,
      blockedOrigins: ['https://blocked.example'],
    }),
  });
  expect(patched.status).toBe(200);

  const storeJson = JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8'));
  expect(storeJson.gatewayKeyRecords).toHaveLength(1);
  expect(JSON.stringify(storeJson)).not.toContain(createdBody.rawKey);
  expect(storeJson.corsOrigins).toEqual(['https://app.example']);
  expect(storeJson.blockedOrigins).toEqual(['https://blocked.example']);
});
```

This test references routes that will be added in later tasks; it may fail with 404 until Task 5 and Task 7 are complete. Keep it committed with the store change only after the endpoints exist, or add it in Task 5. If implementing strictly task-by-task, move this exact test into Task 5.

- [ ] **Step 2: Extend file-store state**

Modify `src/admin/credential-store.ts`:

```typescript
import type { GatewayKeyRecord } from '../config/env.js';
```

Extend `FileStoreState`:

```typescript
interface FileStoreState {
  vertexPools: VertexPoolConfig[];
  modelCatalog: Record<string, ProviderModelCatalog>;
  gatewayKeyRecords?: GatewayKeyRecord[];
  corsOrigins?: string[];
  allowWildcardCors?: boolean;
  blockedOrigins?: string[];
}
```

Extend `AdminCredentialStoreSnapshot`:

```typescript
  gatewayKeyRecords: GatewayKeyRecord[];
  corsOrigins: string[];
  allowWildcardCors: boolean;
  blockedOrigins: string[];
```

Update `storeStateToConfig`:

```typescript
const storeStateToConfig = (
  config: GatewayConfig,
  state: AdminCredentialStoreSnapshot,
): GatewayConfig => createDerivedConfig(config, {
  vertexPools: credentialStateToRuntimePools(state),
  modelCatalog: cloneModelCatalog(state.modelCatalog),
  gatewayKeyRecords: state.gatewayKeyRecords,
  corsOrigins: state.corsOrigins,
  allowWildcardCors: state.allowWildcardCors,
  blockedOrigins: state.blockedOrigins,
});
```

When returning static snapshot in `getSnapshot`, add:

```typescript
        gatewayKeyRecords: [...config.gatewayKeyRecords],
        corsOrigins: [...config.corsOrigins],
        allowWildcardCors: config.allowWildcardCors,
        blockedOrigins: [...config.blockedOrigins],
```

When returning file-store snapshot with no `storeState`, add the same values from config.

When returning file-store snapshot with `storeState`, add:

```typescript
    gatewayKeyRecords: [...(storeState.gatewayKeyRecords ?? config.gatewayKeyRecords)],
    corsOrigins: [...(storeState.corsOrigins ?? config.corsOrigins)],
    allowWildcardCors: storeState.allowWildcardCors ?? config.allowWildcardCors,
    blockedOrigins: [...(storeState.blockedOrigins ?? config.blockedOrigins)],
```

Update `persistFileStoreSnapshot`:

```typescript
  const storeState: FileStoreState = {
    vertexPools: credentialStateToRuntimePools(state),
    modelCatalog: cloneModelCatalog(state.modelCatalog),
    gatewayKeyRecords: state.gatewayKeyRecords,
    corsOrigins: state.corsOrigins,
    allowWildcardCors: state.allowWildcardCors,
    blockedOrigins: state.blockedOrigins,
  };
```

Update the mutable clone in `updateVertexPools`:

```typescript
        gatewayKeyRecords: previous.gatewayKeyRecords.map((entry) => ({ ...entry })),
        corsOrigins: [...previous.corsOrigins],
        allowWildcardCors: previous.allowWildcardCors,
        blockedOrigins: [...previous.blockedOrigins],
```

- [ ] **Step 3: Run compile to catch type errors**

Run:

```bash
npm run compile
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/admin/credential-store.ts
git commit -m "feat: persist admin dashboard state"
```

---

## Task 5: Add gateway key admin APIs

**Files:**
- Modify: `src/admin/admin-routes.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing admin route tests**

Add to `test/admin-routes.test.ts`:

```typescript
it('creates, lists, and revokes managed gateway keys without leaking raw keys after creation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: dir,
      gatewayKeys: ['env-key'],
      gatewayKeyRecords: [],
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);
  const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

  const created = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ label: 'Dashboard client' }),
  });
  const createdBody = await created.json();
  expect(created.status).toBe(200);
  expect(createdBody.rawKey).toMatch(/^vgw_/);
  expect(createdBody.key.keyHash).toBeUndefined();

  const list = await fetch(`${baseUrl}/admin/api/gateway-keys`, {
    headers: { authorization: 'Bearer admin-secret' },
  });
  const listBody = await list.json();
  expect(list.status).toBe(200);
  expect(listBody.gatewayKeys.map((item: { source: string }) => item.source)).toEqual(['env', 'managed']);
  expect(JSON.stringify(listBody)).not.toContain(createdBody.rawKey);

  const revoked = await fetch(`${baseUrl}/admin/api/gateway-keys/${createdBody.key.id}/revoke`, {
    method: 'POST',
    headers,
  });
  const revokedBody = await revoked.json();
  expect(revoked.status).toBe(200);
  expect(revokedBody.key.enabled).toBe(false);
  expect(revokedBody.key.revokedAt).toEqual(expect.any(String));
});
```

- [ ] **Step 2: Run the targeted test to verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "managed gateway keys"
```

Expected: FAIL with 404 for `/admin/api/gateway-keys`.

- [ ] **Step 3: Add helper imports and list builder**

Modify `src/admin/admin-routes.ts` imports:

```typescript
import {
  createGatewayKeyRecord,
  createReadOnlyGatewayKeyRecord,
  redactGatewayKeyRecord,
} from './gateway-key-store.js';
```

Add helper near `buildHealthResponse`:

```typescript
const listGatewayKeys = (config: GatewayConfig, snapshot: AdminCredentialStoreSnapshot) => [
  ...config.gatewayKeys.map(createReadOnlyGatewayKeyRecord).map(redactGatewayKeyRecord),
  ...snapshot.gatewayKeyRecords.map(redactGatewayKeyRecord),
];
```

- [ ] **Step 4: Add gateway key routes**

In `maybeHandleAdminRoute`, after health routes and before vertex credential routes, add:

```typescript
  if (req.method === 'GET' && normalizedPathname === '/admin/api/gateway-keys') {
    sendJson(res, 200, { gatewayKeys: listGatewayKeys(config, store.getSnapshot()) });
    return true;
  }
  if (req.method === 'POST' && normalizedPathname === '/admin/api/gateway-keys') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const label = typeof body.label === 'string' ? body.label : 'Managed key';
    const created = createGatewayKeyRecord(label);
    const snapshot = store.updateVertexPools((state) => ({
      ...state,
      gatewayKeyRecords: [...state.gatewayKeyRecords, created.record],
    }));
    sendJson(res, 200, {
      ok: true,
      rawKey: created.rawKey,
      key: redactGatewayKeyRecord(findCredentialOrThrow({ vertexPools: snapshot.gatewayKeyRecords }, created.record.id)),
    });
    return true;
  }

  const gatewayKeyRevokeMatch = normalizedPathname.match(/^\/admin\/api\/gateway-keys\/([^/]+)\/revoke$/);
  if (gatewayKeyRevokeMatch && req.method === 'POST') {
    const id = decodeURIComponent(gatewayKeyRevokeMatch[1]);
    const revokedAt = new Date().toISOString();
    const snapshot = store.updateVertexPools((state) => ({
      ...state,
      gatewayKeyRecords: state.gatewayKeyRecords.map((entry) => entry.id === id ? {
        ...entry,
        enabled: false,
        revokedAt,
      } : entry),
    }));
    const key = snapshot.gatewayKeyRecords.find((entry) => entry.id === id);
    if (!key) throw new GatewayError(404, 'NOT_FOUND', 'Gateway key not found.');
    sendJson(res, 200, { ok: true, key: redactGatewayKeyRecord(key) });
    return true;
  }
```

If TypeScript rejects `findCredentialOrThrow` because it expects `vertexPools`, replace the `key` lookup in the POST route with:

```typescript
    const key = snapshot.gatewayKeyRecords.find((entry) => entry.id === created.record.id);
    if (!key) throw new GatewayError(500, 'INTERNAL', 'Created gateway key was not persisted.');
```

- [ ] **Step 5: Run admin route tests**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "managed gateway keys"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: add admin gateway key endpoints"
```

---

## Task 6: Add in-memory API request log store

**Files:**
- Create: `src/admin/request-log-store.ts`
- Test: `test/request-log-store.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `test/request-log-store.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { AdminRequestLogStore } from '../src/admin/request-log-store.js';

describe('AdminRequestLogStore', () => {
  it('keeps only the newest entries and redacts secret-looking fields', () => {
    const store = new AdminRequestLogStore(2);

    store.record({
      requestId: 'r1',
      method: 'POST',
      path: '/one',
      status: 200,
      latencyMs: 12,
      routeFamily: 'gemini',
      operation: 'generateContent',
      model: 'gemini-3.5-flash',
      gatewayKeyPreview: 'test...key',
      upstreamTarget: 'target-a',
      tokens: 10,
      errorCode: null,
    });
    store.record({ requestId: 'r2', method: 'POST', path: '/two?api_key=secret', status: 500, latencyMs: 20 });
    store.record({ requestId: 'r3', method: 'GET', path: '/three', status: 404, latencyMs: 3 });

    const entries = store.list({ limit: 10 });
    expect(entries.map((entry) => entry.requestId)).toEqual(['r3', 'r2']);
    expect(JSON.stringify(entries)).not.toContain('secret');
    expect(entries[1].path).toBe('/two?[redacted]');
  });

  it('filters by status family and route family', () => {
    const store = new AdminRequestLogStore(10);
    store.record({ requestId: 'ok', method: 'POST', path: '/ok', status: 200, latencyMs: 1, routeFamily: 'openai' });
    store.record({ requestId: 'bad', method: 'POST', path: '/bad', status: 502, latencyMs: 2, routeFamily: 'gemini' });

    expect(store.list({ status: '5xx' }).map((entry) => entry.requestId)).toEqual(['bad']);
    expect(store.list({ routeFamily: 'openai' }).map((entry) => entry.requestId)).toEqual(['ok']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- test/request-log-store.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement request log store**

Create `src/admin/request-log-store.ts`:

```typescript
export interface AdminRequestLogEntry {
  id: number;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  latencyMs: number;
  routeFamily?: string;
  operation?: string;
  model?: string;
  gatewayKeyPreview?: string | null;
  upstreamTarget?: string | null;
  tokens?: number | null;
  errorCode?: string | null;
}

export type AdminRequestLogInput = Omit<AdminRequestLogEntry, 'id' | 'timestamp'>;

export interface AdminRequestLogFilter {
  limit?: number;
  status?: '2xx' | '4xx' | '5xx';
  routeFamily?: string;
  search?: string;
}

const redactPath = (path: string): string => {
  if (!/[?&](api_key|key|token|authorization)=/i.test(path)) return path;
  const queryIndex = path.indexOf('?');
  return queryIndex === -1 ? path : `${path.slice(0, queryIndex)}?[redacted]`;
};

const matchesStatus = (status: number, filter?: AdminRequestLogFilter['status']): boolean => {
  if (!filter) return true;
  if (filter === '2xx') return status >= 200 && status < 300;
  if (filter === '4xx') return status >= 400 && status < 500;
  return status >= 500 && status < 600;
};

export class AdminRequestLogStore {
  private nextId = 1;
  private readonly entries: AdminRequestLogEntry[] = [];

  constructor(private readonly maxEntries = 500) {}

  record(input: AdminRequestLogInput): void {
    const entry: AdminRequestLogEntry = {
      ...input,
      id: this.nextId,
      timestamp: new Date().toISOString(),
      path: redactPath(input.path),
    };
    this.nextId += 1;
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  list(filter: AdminRequestLogFilter = {}): AdminRequestLogEntry[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), this.maxEntries);
    const search = filter.search?.trim().toLowerCase();
    return this.entries
      .filter((entry) => matchesStatus(entry.status, filter.status))
      .filter((entry) => !filter.routeFamily || entry.routeFamily === filter.routeFamily)
      .filter((entry) => !search || JSON.stringify(entry).toLowerCase().includes(search))
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
  }
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- test/request-log-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/request-log-store.ts test/request-log-store.test.ts
git commit -m "feat: add admin request log store"
```

---

## Task 7: Wire API logging into the app and admin API

**Files:**
- Modify: `src/app.ts`
- Modify: `src/admin/admin-routes.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing integration test**

Add to `test/admin-routes.test.ts`:

```typescript
it('returns recent redacted API call logs to admin users', async () => {
  const generateContent = vi.fn(async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      gatewayKeys: ['test-key'],
    }),
    genAiFactory: () => ({ models: { generateContent } }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.5-flash:generateContent?api_key=secret`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply OK' }] }] }),
  });

  const logs = await fetch(`${baseUrl}/admin/api/logs?limit=5`, {
    headers: { authorization: 'Bearer admin-secret' },
  });
  const body = await logs.json();

  expect(logs.status).toBe(200);
  expect(body.logs[0].routeFamily).toBe('gemini');
  expect(body.logs[0].model).toBe('gemini-3.5-flash');
  expect(body.logs[0].gatewayKeyPreview).toBe('test...key');
  expect(JSON.stringify(body)).not.toContain('secret');
});
```

- [ ] **Step 2: Run targeted test to verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "API call logs"
```

Expected: FAIL with 404 for `/admin/api/logs`.

- [ ] **Step 3: Extend app options and create log store**

Modify `src/app.ts` imports:

```typescript
import { AdminRequestLogStore } from './admin/request-log-store.js';
```

Add to `AppOptions`:

```typescript
  requestLogStore?: AdminRequestLogStore;
```

Change `createApp` signature:

```typescript
export const createApp = ({ config, genAiFactory = createGoogleGenAiClient, runtimeFactory, requestLogStore = new AdminRequestLogStore() }: AppOptions) => {
```

Pass the store to admin routes:

```typescript
      if (await maybeHandleAdminRoute(req, res, url, config, runtime ?? undefined, requestLogStore)) {
```

- [ ] **Step 4: Track route and gateway key metadata**

In `src/app.ts`, inside the request handler before `try`, add:

```typescript
    let logRouteFamily: string | undefined;
    let logOperation: string | undefined;
    let logModel: string | undefined;
    let logGatewayKeyPreview: string | null = null;
```

After `const route = classifyRoute(...)`, add:

```typescript
      logRouteFamily = route.family;
      logOperation = route.operation;
      logModel = route.model;
```

After `const gatewayKey = extractGatewayKey(req);`, add:

```typescript
      logGatewayKeyPreview = gatewayKey && gatewayKey.length > 8
        ? `${gatewayKey.slice(0, 4)}...${gatewayKey.slice(-3)}`
        : gatewayKey ? `${gatewayKey.slice(0, 4)}...` : null;
```

In `finally`, before `ctx.log(...)`, add:

```typescript
      if (!ctx.path.startsWith('/admin')) {
        requestLogStore.record({
          requestId: ctx.id,
          method: ctx.method,
          path: ctx.path,
          status: res.statusCode,
          latencyMs: Date.now() - ctx.startedAt,
          routeFamily: logRouteFamily,
          operation: logOperation,
          model: logModel,
          gatewayKeyPreview: logGatewayKeyPreview,
          upstreamTarget: null,
          tokens: null,
          errorCode: res.statusCode >= 400 ? String(res.statusCode) : null,
        });
      }
```

- [ ] **Step 5: Add logs route**

Modify `src/admin/admin-routes.ts` imports:

```typescript
import type { AdminRequestLogStore } from './request-log-store.js';
```

Change `maybeHandleAdminRoute` signature:

```typescript
export const maybeHandleAdminRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  config: GatewayConfig,
  runtime?: GenAiRuntimeLike,
  requestLogStore?: AdminRequestLogStore,
): Promise<boolean> => {
```

Add route after health routes:

```typescript
  if (req.method === 'GET' && normalizedPathname === '/admin/api/logs') {
    sendJson(res, 200, {
      logs: requestLogStore?.list({
        limit: Number(url.searchParams.get('limit') ?? 100),
        status: (url.searchParams.get('status') || undefined) as '2xx' | '4xx' | '5xx' | undefined,
        routeFamily: url.searchParams.get('routeFamily') || undefined,
        search: url.searchParams.get('search') || undefined,
      }) ?? [],
    });
    return true;
  }
```

- [ ] **Step 6: Run targeted test**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "API call logs"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts src/admin/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: expose admin API call logs"
```

---

## Task 8: Add domain blacklist enforcement and admin policy API

**Files:**
- Create: `src/lib/domain-policy.ts`
- Modify: `src/app.ts`
- Modify: `src/admin/admin-routes.ts`
- Test: `test/domain-policy.test.ts`
- Test: `test/cors.test.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write domain policy unit tests**

Create `test/domain-policy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { isOriginBlocked, matchesOriginPattern } from '../src/lib/domain-policy.js';

describe('domain policy', () => {
  it('matches exact origins and wildcard subdomains', () => {
    expect(matchesOriginPattern('https://app.example.com', 'https://app.example.com')).toBe(true);
    expect(matchesOriginPattern('https://api.example.com', 'https://*.example.com')).toBe(true);
    expect(matchesOriginPattern('https://example.com', 'https://*.example.com')).toBe(false);
  });

  it('blocks origins from configured patterns', () => {
    expect(isOriginBlocked('https://evil.example.com', ['https://*.example.com'])).toBe(true);
    expect(isOriginBlocked('https://safe.test', ['https://*.example.com'])).toBe(false);
    expect(isOriginBlocked(undefined, ['https://*.example.com'])).toBe(false);
  });
});
```

- [ ] **Step 2: Write admin and CORS integration tests**

Add to `test/admin-routes.test.ts`:

```typescript
it('returns and updates domain policy through admin API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: dir,
      corsOrigins: ['https://old.example'],
      allowWildcardCors: false,
      blockedOrigins: [],
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);
  const headers = { authorization: 'Bearer admin-secret', 'content-type': 'application/json' };

  const patched = await fetch(`${baseUrl}/admin/api/domain-policy`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      corsOrigins: ['https://app.example'],
      allowWildcardCors: false,
      blockedOrigins: ['https://blocked.example'],
    }),
  });
  expect(patched.status).toBe(200);

  const current = await fetch(`${baseUrl}/admin/api/domain-policy`, {
    headers: { authorization: 'Bearer admin-secret' },
  });
  const body = await current.json();
  expect(body).toEqual({
    corsOrigins: ['https://app.example'],
    allowWildcardCors: false,
    blockedOrigins: ['https://blocked.example'],
  });
});
```

Add to `test/cors.test.ts`:

```typescript
it('rejects requests from blocked browser origins before route handling', async () => {
  const generateContent = vi.fn(async () => ({}));
  const server = createApp({
    config: testConfig({ blockedOrigins: ['https://blocked.example'] }),
    genAiFactory: () => ({ models: { generateContent } }),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.5-flash:generateContent`, {
    method: 'POST',
    headers: {
      origin: 'https://blocked.example',
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'OK' }] }] }),
  });

  expect(response.status).toBe(403);
  expect(generateContent).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test -- test/domain-policy.test.ts test/admin-routes.test.ts test/cors.test.ts -t "domain policy|blocked browser origins"
```

Expected: FAIL with missing module or 404.

- [ ] **Step 4: Implement domain policy helper**

Create `src/lib/domain-policy.ts`:

```typescript
import { GatewayError } from '../http/error-response.js';

export const matchesOriginPattern = (origin: string, pattern: string): boolean => {
  const cleanOrigin = origin.trim().toLowerCase();
  const cleanPattern = pattern.trim().toLowerCase();
  if (!cleanOrigin || !cleanPattern) return false;
  if (!cleanPattern.includes('*')) return cleanOrigin === cleanPattern;
  if (!cleanPattern.startsWith('https://*.') && !cleanPattern.startsWith('http://*.')) return false;
  const suffix = cleanPattern.replace('://*.', '://');
  return cleanOrigin.endsWith(`.${suffix.replace(/^https?:\/\//, '')}`)
    && cleanOrigin.startsWith(cleanPattern.startsWith('https://') ? 'https://' : 'http://');
};

export const isOriginBlocked = (origin: string | undefined, blockedOrigins: string[]): boolean => {
  if (!origin) return false;
  return blockedOrigins.some((pattern) => matchesOriginPattern(origin, pattern));
};

export const enforceBlockedOrigin = (origin: string | undefined, blockedOrigins: string[]): void => {
  if (isOriginBlocked(origin, blockedOrigins)) {
    throw new GatewayError(403, 'ORIGIN_BLOCKED', 'Origin is blocked by gateway domain policy.');
  }
};
```

- [ ] **Step 5: Enforce blocked origins in app**

Modify `src/app.ts` imports:

```typescript
import { enforceBlockedOrigin } from './lib/domain-policy.js';
```

After admin route handling and before `applyCors(req, res, config);`, add:

```typescript
      enforceBlockedOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : undefined, config.blockedOrigins);
```

- [ ] **Step 6: Add admin domain policy routes**

In `src/admin/admin-routes.ts`, add after gateway key routes:

```typescript
  if (req.method === 'GET' && normalizedPathname === '/admin/api/domain-policy') {
    const snapshot = store.getSnapshot();
    sendJson(res, 200, {
      corsOrigins: snapshot.corsOrigins,
      allowWildcardCors: snapshot.allowWildcardCors,
      blockedOrigins: snapshot.blockedOrigins,
    });
    return true;
  }
  if (req.method === 'PATCH' && normalizedPathname === '/admin/api/domain-policy') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const snapshot = store.updateVertexPools((state) => ({
      ...state,
      corsOrigins: Array.isArray(body.corsOrigins)
        ? body.corsOrigins.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : state.corsOrigins,
      allowWildcardCors: typeof body.allowWildcardCors === 'boolean'
        ? body.allowWildcardCors
        : state.allowWildcardCors,
      blockedOrigins: Array.isArray(body.blockedOrigins)
        ? body.blockedOrigins.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : state.blockedOrigins,
    }));
    sendJson(res, 200, {
      corsOrigins: snapshot.corsOrigins,
      allowWildcardCors: snapshot.allowWildcardCors,
      blockedOrigins: snapshot.blockedOrigins,
    });
    return true;
  }
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test -- test/domain-policy.test.ts test/admin-routes.test.ts test/cors.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/domain-policy.ts src/app.ts src/admin/admin-routes.ts test/domain-policy.test.ts test/admin-routes.test.ts test/cors.test.ts
git commit -m "feat: add admin domain policy controls"
```

---

## Task 9: Add Vertex API-key target creation endpoint

**Files:**
- Modify: `src/admin/credential-store.ts`
- Modify: `src/admin/admin-routes.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing test**

Add to `test/admin-routes.test.ts`:

```typescript
it('creates full Vertex API-key targets without leaking the key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-admin-'));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: dir,
      runtimeMode: 'pool',
      vertexPools: [],
      resolvedVertexTargets: [],
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/api/vertex-credentials/api-key`, {
    method: 'POST',
    headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Full Vertex key',
      project: 'project-a',
      location: 'global',
      apiKey: 'google-api-key-secret',
      apiKeyMode: 'full',
      weight: 2,
    }),
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.credential.label).toBe('Full Vertex key');
  expect(body.credential.project).toBe('project-a');
  expect(body.credential.location).toBe('global');
  expect(body.credential.hasApiKey).toBe(true);
  expect(body.credential.apiKey).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('google-api-key-secret');
});
```

- [ ] **Step 2: Run targeted test to verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "API-key targets"
```

Expected: FAIL with 404.

- [ ] **Step 3: Add API-key import helper**

Modify `src/admin/credential-store.ts`:

```typescript
export const createApiKeyVertexCredential = (
  config: GatewayConfig,
  body: Record<string, unknown>,
): AdminVertexCredentialRecord => {
  assertWritableMode(config);
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiKeyMode = body.apiKeyMode === 'express' ? 'express' : 'full';
  if (!project || !location || !apiKey) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'project, location, and apiKey are required.');
  }
  const id = sanitizeCredentialId(`${project}-${location}-api-key-${apiKey.slice(-6)}`);
  return {
    id,
    label: typeof body.label === 'string' ? body.label.trim() || undefined : undefined,
    project,
    location,
    credentialsFile: null,
    apiKey,
    apiKeyMode,
    enabled: body.enabled !== false,
    weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    modelAllowlist: Array.isArray(body.modelAllowlist)
      ? body.modelAllowlist.filter((value): value is string => typeof value === 'string')
      : [],
    modelExclusions: Array.isArray(body.modelExclusions)
      ? body.modelExclusions.filter((value): value is string => typeof value === 'string')
      : [],
  };
};
```

- [ ] **Step 4: Add route**

Modify imports in `src/admin/admin-routes.ts`:

```typescript
  importApiKeyCredential,
```

Add before service-account import route:

```typescript
  if (req.method === 'POST' && normalizedPathname === '/admin/api/vertex-credentials/api-key') {
    const body = await parseJsonBody(req, config.maxJsonBytes);
    const credential = importApiKeyCredential(config, body);
    const snapshot = store.updateVertexPools((state) => ({
      ...state,
      vertexPools: [...state.vertexPools.filter((entry) => entry.id !== credential.id), credential],
    }));
    sendJson(res, 200, {
      ok: true,
      credential: findCredentialOrThrow(withRuntimeHealth(snapshot, runtime), credential.id),
    });
    return true;
  }
```

- [ ] **Step 5: Run targeted test**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "API-key targets"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/credential-store.ts src/admin/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: add vertex api key target endpoint"
```

---

## Task 10: Add admin security status endpoint

**Files:**
- Modify: `src/admin/admin-routes.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing test**

Add to `test/admin-routes.test.ts`:

```typescript
it('reports admin security status without exposing the admin token', async () => {
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminToken: 'shared-secret',
      gatewayKeys: ['shared-secret'],
      adminStoreMode: 'static-config',
      adminAllowMutations: false,
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/api/security`, {
    headers: { authorization: 'Bearer shared-secret' },
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({
    adminRoutesEnabled: true,
    adminTokenConfigured: true,
    adminTokenConflictsWithGatewayKey: true,
    mutationsEnabled: false,
    storeMode: 'static-config',
  });
  expect(JSON.stringify(body)).not.toContain('shared-secret');
});
```

- [ ] **Step 2: Run targeted test to verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "admin security status"
```

Expected: FAIL with 404.

- [ ] **Step 3: Add route**

In `src/admin/admin-routes.ts`, add after health routes:

```typescript
  if (req.method === 'GET' && normalizedPathname === '/admin/api/security') {
    sendJson(res, 200, {
      adminRoutesEnabled: config.enableAdminRoutes,
      adminTokenConfigured: Boolean(config.adminToken),
      adminTokenConflictsWithGatewayKey: Boolean(
        config.adminToken && config.gatewayKeys.some((key) => key === config.adminToken),
      ),
      mutationsEnabled: config.adminAllowMutations,
      storeMode: config.adminStoreMode,
    });
    return true;
  }
```

- [ ] **Step 4: Run targeted test**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "admin security status"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: expose admin security status"
```

---

## Task 11: Refresh admin UI shell for the dashboard controls

**Files:**
- Modify: `src/admin/admin-ui.ts`
- Test: `test/admin-ui.test.ts`

- [ ] **Step 1: Update failing UI expectations**

Modify `test/admin-ui.test.ts`:

```typescript
describe('admin ui', () => {
  it('renders a self-contained operator console with key, credential, log, and policy sections', () => {
    const html = renderAdminUi();

    expect(html).toContain('Vertex Gateway Admin');
    expect(html).toContain('Gateway API keys');
    expect(html).toContain('Vertex credentials');
    expect(html).toContain('API call logs');
    expect(html).toContain('Domain policy');
    expect(html).toContain('Security notices');
    expect(html).toContain('id="gateway-key-list"');
    expect(html).toContain('id="domain-policy-form"');
    expect(html).toContain('id="api-log-table"');
    expect(html).toContain('/admin/api/gateway-keys');
    expect(html).toContain('/admin/api/vertex-credentials/api-key');
    expect(html).toContain('/admin/api/logs');
    expect(html).toContain('/admin/api/domain-policy');
    expect(html).toContain('/admin/api/security');
    expect(html).toContain('sessionStorage');
    expect(html).not.toContain('Management Center');
    expect(html).not.toContain('Cyan-to-Violet');
  });
});
```

- [ ] **Step 2: Run UI test to verify failure**

Run:

```bash
npm test -- test/admin-ui.test.ts
```

Expected: FAIL because old labels are still present.

- [ ] **Step 3: Apply minimal UI shell changes**

Modify `src/admin/admin-ui.ts` only enough to expose the new backend. Keep it self-contained.

Update `bootstrapState` views:

```typescript
  const bootstrapState = {
    provider: 'gemini',
    views: ['dashboard', 'gateway-keys', 'vertex-credentials', 'api-logs', 'domain-policy', 'security'],
  };
```

Update the `<title>`:

```html
<title>Vertex Gateway Admin</title>
```

Update CSS root tokens to match `DESIGN.md`:

```css
:root {
  color-scheme: dark;
  --bg: #0B1020;
  --panel: #111827;
  --panel-strong: #1E293B;
  --ink: #E5E7EB;
  --muted: #94A3B8;
  --line: #263244;
  --accent: #2DD4BF;
  --accent-strong: #5EEAD4;
  --success: #22C55E;
  --danger: #EF4444;
  --warn: #F59E0B;
  --radius-lg: 12px;
  --radius-md: 10px;
  --radius-sm: 8px;
}
```

Add static section containers with these IDs if they do not already exist:

```html
<section class="panel" id="gateway-keys-panel">
  <h2>Gateway API keys</h2>
  <p class="panel-subtitle">Client đến Gateway. Đây không phải Google Cloud API key.</p>
  <div id="gateway-key-list"></div>
</section>
<section class="panel" id="vertex-credentials-panel">
  <h2>Vertex credentials</h2>
  <p class="panel-subtitle">Gateway đến Google. API key và private key luôn được ẩn.</p>
</section>
<section class="panel" id="api-logs-panel">
  <h2>API call logs</h2>
  <div id="api-log-table"></div>
</section>
<section class="panel" id="domain-policy-panel">
  <h2>Domain policy</h2>
  <form id="domain-policy-form"></form>
</section>
<section class="panel" id="security-panel">
  <h2>Security notices</h2>
  <div id="security-notices"></div>
</section>
```

Ensure the client script references the new endpoints:

```javascript
const endpoints = {
  gatewayKeys: '/admin/api/gateway-keys',
  vertexApiKey: '/admin/api/vertex-credentials/api-key',
  logs: '/admin/api/logs',
  domainPolicy: '/admin/api/domain-policy',
  security: '/admin/api/security',
};
```

Do not rewrite the whole UI. This task is only to unblock the backend controls and align the shell language/style.

- [ ] **Step 4: Run UI tests**

Run:

```bash
npm test -- test/admin-ui.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/admin-ui.ts test/admin-ui.test.ts
git commit -m "feat: refresh admin dashboard shell"
```

---

## Task 12: Document and validate the MVP backend dashboard

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md` if implementation discoveries require small corrections.

- [ ] **Step 1: Add README admin section**

Add a section to `README.md`:

```markdown
## Admin dashboard backend

Enable admin routes with:

```env
GATEWAY_ENABLE_ADMIN_ROUTES=true
GATEWAY_ADMIN_TOKEN=replace-with-admin-only-token
GATEWAY_ADMIN_STORE_MODE=file-store
GATEWAY_ADMIN_ALLOW_MUTATIONS=true
GATEWAY_ADMIN_FILE_STORE_DIR=.gateway-admin
```

Admin routes live under `/admin` and `/admin/api/*`.

Security rules:

- `GATEWAY_ADMIN_TOKEN` must not match any gateway API key.
- Gateway API keys are Client to Gateway credentials.
- Vertex credentials are Gateway to Google credentials.
- Managed gateway keys are stored as SHA-256 hashes and the raw key is shown only once at creation.
- API logs are in-memory and redacted; they are not an audit log database.
- Domain blacklist only applies to browser requests with an `Origin` header.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- test/gateway-key-store.test.ts test/request-log-store.test.ts test/domain-policy.test.ts test/auth.test.ts test/admin-routes.test.ts test/cors.test.ts test/admin-ui.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run compile**

Run:

```bash
npm run compile
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md DESIGN.md
git commit -m "docs: document admin dashboard backend"
```

---

## Self-review

### Spec coverage

- Gateway API key management: Tasks 1, 3, 4, 5.
- Admin password/access: Task 10, with deliberate no-runtime-rotation scope.
- Vertex API key, project ID, location: Task 9 plus existing service-account routes.
- API call logs: Tasks 6 and 7.
- Domain allowlist and blacklist: Tasks 2, 4, 8.
- Stitch/DESIGN.md visual direction: Task 11.
- Security posture: Tasks 1, 3, 5, 9, 10, 12.

### Placeholder scan

No `TBD`, `TODO`, or `implement later` placeholders are intended in this plan. If a worker finds one, replace it with concrete code before executing that step.

### Type consistency

- Config field name is `gatewayKeyRecords` everywhere.
- Domain blacklist field name is `blockedOrigins` everywhere.
- Request log route is `/admin/api/logs` everywhere.
- Gateway key route is `/admin/api/gateway-keys` everywhere.
- Vertex API-key target route is `/admin/api/vertex-credentials/api-key` everywhere.

---

## Recommended execution order

1. Task 1 - independent helper.
2. Task 2 - config fields.
3. Task 3 - auth integration.
4. Task 4 - file-store persistence.
5. Task 5 - gateway key API.
6. Task 6 - log store.
7. Task 7 - log API.
8. Task 8 - domain policy.
9. Task 9 - Vertex API-key target.
10. Task 10 - security status.
11. Task 11 - UI shell.
12. Task 12 - docs and validation.

Commit after every task. Do not batch the entire plan into one commit.
