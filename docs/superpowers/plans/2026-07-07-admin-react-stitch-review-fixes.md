# Admin React Stitch Review Fixes Implementation Plan

> Status note: the current repo already includes several fixes called out in the review comments below, including per-IP+username admin login throttling, future-timestamp rejection for admin sessions, partial catalog loading with `Promise.allSettled`, and pending-state protection in `AuthFilesView`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every valid PR #8 review finding for the React admin replacement without expanding the admin product scope.

**Architecture:** Keep `/admin/api/*` as the backend contract and keep the React app as the only active `/admin` presentation layer. The fix set hardens backend SPA serving, bundles the SPA into Docker, passes the authenticated admin token from `AdminApp` into child views, and corrects catalog/credential UI state so operators cannot act on stale or empty data.

**Tech Stack:** Node.js 22, TypeScript, Vitest, Docker multi-stage builds, React 19, Vite 8, Tailwind v4, oxlint.

---

## Review Finding Scope

Implement these valid findings:

- Docker image does not build or copy `frontend/dist`, so deployed `/admin` returns `503 ADMIN_UI_NOT_BUILT`.
- `serveAdminAsset()` accepts directories and lacks a read-stream error handler.
- Malformed `/admin/assets/*` percent-encoding becomes an internal error instead of a validation error.
- Static admin asset path traversal should have regression tests so the existing containment check cannot be weakened later.
- `useAdminToken()` is component-local, so child views get an empty token when they call it independently.
- `AIProvidersView` test action does not refresh health after a successful test.
- `AuthFilesView` is read-only despite backend support for test, enable/disable, and delete.
- `ModelCatalogEditor` keeps stale local state when the `catalog` prop changes.
- `ModelCatalogEditor` uses a raw `<textarea>` instead of the shared `Textarea`.
- `AvailableModelsView` only fetches Gemini, omits default/alias targets, and can render duplicate model keys with conflicting statuses.
- `ModelManagementView` can render editable empty fallback catalogs after a load failure.
- `fetchAdminHealth()` treats disabled or unknown targets as degraded.
- `reload()` in `useAdminDashboardData()` can set health from a stale token after logout or token change.
- Backend route tests rely on an already-built `frontend/dist/index.html` in the local workspace.
- `/admin/api/auth/login` has no throttling, so repeated bad passwords can drive repeated `scrypt` verification work.
- File-store session tokens have no expiry and the React logout button only clears client memory.
- Admin credential responses expose absolute `credentialsFile` paths to the browser.

Do not implement this disputed finding unless token persistence is introduced in the same branch:

- "Refresh bypasses forced password change gate." Current `useAdminToken()` intentionally stores the token only in component memory, so a full page refresh clears the token and returns the operator to login.
- "API failures erase create/import form input." Current create/import actions in `useAdminDashboardData()` rethrow after setting dashboard error, and `GatewayKeyDialog`, `VertexTargetDialog`, and `ServiceAccountTargetDialog` only clear/close after `await onCreate(...)` succeeds. Revoke/reload actions still swallow errors, but they are button actions without form input to preserve.

Track as a non-blocking follow-up, not a PR #8 merge blocker:

- Add a real frontend test harness and coverage for the SPA. The current PR has no frontend test coverage, but the immediate review findings can be validated by lint/build and backend route tests.

## File Structure

- Modify `Dockerfile`: add a frontend build stage and copy `frontend/dist` into the production image.
- Modify `src/admin/admin-spa.ts`: validate decoded asset paths, reject directories, and handle stream errors.
- Modify `test/admin-routes.test.ts`: create an isolated admin SPA fixture during tests and cover asset error cases.
- Modify `src/http/error-response.ts`: add a `RATE_LIMITED` error code for admin login throttling.
- Modify `src/config/admin-settings-store.ts`: persist session-token creation time for TTL enforcement.
- Modify `src/admin/admin-routes.ts`: add login throttling, file-store session TTL, logout invalidation, and sanitized credential responses.
- Modify `frontend/src/lib/admin-dashboard-api.ts`: add logout client helper and sanitized credential metadata.
- Modify `frontend/src/pages/AdminApp.tsx`: pass the authenticated token to child views.
- Modify `frontend/src/pages/AIProvidersView.tsx`: accept token as prop and refresh after credential test.
- Modify `frontend/src/pages/AuthFilesView.tsx`: accept token as prop and wire credential actions.
- Modify `frontend/src/pages/AvailableModelsView.tsx`: accept token as prop, fetch all providers, merge default/alias/allowlist/disabled models, and dedupe.
- Modify `frontend/src/pages/ModelManagementView.tsx`: accept token as prop and hide editors after load failure.
- Modify `frontend/src/components/console/ModelCatalogEditor.tsx`: sync local state from props and use shared `Textarea`.
- Modify `frontend/src/lib/admin-dashboard-api.ts`: count only actionable degraded runtime target statuses.
- Modify `frontend/src/hooks/useAdminDashboardData.ts`: guard runtime reload against stale token updates.

### Task 1: Harden Admin SPA Serving And Docker Packaging

**Files:**
- Modify: `Dockerfile`
- Modify: `src/admin/admin-spa.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Write backend tests for SPA fixture independence and asset errors**

Add these helpers near the top of `test/admin-routes.test.ts`, after `listen`:

```ts
const adminDistDir = path.join(process.cwd(), 'frontend', 'dist');
const adminAssetsDir = path.join(adminDistDir, 'assets');
const adminIndexPath = path.join(adminDistDir, 'index.html');
const adminFixtureAssetPath = path.join(adminAssetsDir, 'admin-fixture.js');
const adminFixtureDirPath = path.join(adminAssetsDir, 'directory-fixture');

let previousAdminIndex: string | null | undefined;

const writeAdminSpaFixture = (): void => {
  previousAdminIndex = fs.existsSync(adminIndexPath)
    ? fs.readFileSync(adminIndexPath, 'utf8')
    : null;
  fs.mkdirSync(adminAssetsDir, { recursive: true });
  fs.mkdirSync(adminFixtureDirPath, { recursive: true });
  fs.writeFileSync(
    adminIndexPath,
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/admin/assets/admin-fixture.js"></script></body></html>',
  );
  fs.writeFileSync(adminFixtureAssetPath, 'console.log("admin fixture");');
};

const restoreAdminSpaFixture = (): void => {
  if (fs.existsSync(adminFixtureAssetPath)) fs.unlinkSync(adminFixtureAssetPath);
  if (fs.existsSync(adminFixtureDirPath)) fs.rmSync(adminFixtureDirPath, { recursive: true, force: true });
  if (previousAdminIndex === null) {
    if (fs.existsSync(adminIndexPath)) fs.unlinkSync(adminIndexPath);
  } else if (typeof previousAdminIndex === 'string') {
    fs.writeFileSync(adminIndexPath, previousAdminIndex);
  }
  previousAdminIndex = undefined;
};
```

Update the suite `afterEach` so it restores the fixture before closing the server:

```ts
afterEach(async () => {
  restoreAdminSpaFixture();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});
```

Call `writeAdminSpaFixture()` at the start of each test that expects `GET /admin` to return the React shell.

Add these tests inside the admin route suite:

```ts
it('serves built React admin assets from /admin/assets', async () => {
  writeAdminSpaFixture();
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/assets/admin-fixture.js`);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/javascript');
  expect(response.headers.get('cache-control')).toContain('immutable');
  expect(body).toContain('admin fixture');
});

it('rejects malformed admin asset URLs as validation errors', async () => {
  writeAdminSpaFixture();
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/assets/%E0%A4%A`);
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error.code).toBe('VALIDATION_FAILED');
});

it('does not stream directories from /admin/assets', async () => {
  writeAdminSpaFixture();
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/assets/directory-fixture`);
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body.error.code).toBe('NOT_FOUND');
});
```

Add this path traversal regression test:

```ts
it('rejects path traversal attempts from /admin/assets', async () => {
  writeAdminSpaFixture();
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/assets/%2e%2e/index.html`);
  const body = await response.json();

  expect(response.status).toBe(400);
  expect(body.error.code).toBe('VALIDATION_FAILED');
});
```

- [ ] **Step 2: Run backend route tests and verify failure**

Run: `npm test -- test/admin-routes.test.ts`

Expected before implementation: at least the malformed URL or directory asset test fails against current `src/admin/admin-spa.ts`.

- [ ] **Step 3: Harden `src/admin/admin-spa.ts`**

Replace the import and helper logic with this implementation:

```ts
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { GatewayError } from '../http/error-response.js';

const FRONTEND_DIST = path.resolve(process.cwd(), 'frontend', 'dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');
const ADMIN_ASSET_PREFIX = '/admin/assets/';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const resolveAdminAssetPath = (pathname: string): string => {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(ADMIN_ASSET_PREFIX.length));
  } catch {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Invalid admin asset path.');
  }
  const resolved = path.resolve(FRONTEND_DIST, 'assets', relative);
  const assetRoot = path.resolve(FRONTEND_DIST, 'assets');
  if (!resolved.startsWith(`${assetRoot}${path.sep}`)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Invalid admin asset path.');
  }
  return resolved;
};

const isReadableFile = (assetPath: string): boolean => {
  try {
    return existsSync(assetPath) && statSync(assetPath).isFile();
  } catch {
    return false;
  }
};

export const renderAdminSpa = async (): Promise<string> => {
  if (!existsSync(INDEX_HTML)) {
    throw new GatewayError(503, 'ADMIN_UI_NOT_BUILT', 'React admin app is not built. Run `cd frontend && npm run build`.');
  }
  return readFile(INDEX_HTML, 'utf8');
};

export const serveAdminAsset = (pathname: string, res: ServerResponse): boolean => {
  if (!pathname.startsWith(ADMIN_ASSET_PREFIX)) return false;
  const assetPath = resolveAdminAssetPath(pathname);
  if (!isReadableFile(assetPath)) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin asset is not found.');
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypes[path.extname(assetPath)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  const stream = createReadStream(assetPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
  return true;
};
```

- [ ] **Step 4: Bundle frontend assets into Docker image**

Replace `Dockerfile` with this multi-stage build:

```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=optional

FROM deps AS compile
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-bookworm-slim AS frontend-deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM frontend-deps AS frontend-build
WORKDIR /app/frontend
COPY frontend ./
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=compile /app/compiled ./compiled
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY package.json ./package.json
CMD ["node", "compiled/server.js"]
```

- [ ] **Step 5: Verify task**

Run:

```bash
npm test -- test/admin-routes.test.ts
docker build -t vertex-gateway-admin-spa-review-fix .
```

Expected:

- `test/admin-routes.test.ts` passes.
- Docker build reaches `RUN npm run build` in the frontend stage and final image contains `/app/frontend/dist`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile src/admin/admin-spa.ts test/admin-routes.test.ts
git commit -m "fix: harden admin spa serving and docker bundle"
```

### Task 2: Harden Admin Auth Sessions And Credential Responses

> Note: this plan originally proposed keeping a sanitized `fileName` in admin credential responses. The implemented repo state now removes `fileName` from the backend contract entirely, so the frontend type-mapping steps below should be skipped and any remaining `fileName` references should be deleted instead.

**Files:**
- Modify: `src/http/error-response.ts`
- Modify: `src/config/admin-settings-store.ts`
- Modify: `src/admin/admin-routes.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `frontend/src/types/admin.ts`
- Modify: `frontend/src/lib/admin-dashboard-api.ts`

- [ ] **Step 1: Write backend tests for login throttling, logout, and sanitized paths**

Add these tests to `test/admin-routes.test.ts` inside the admin route suite:

```ts
it('rate-limits repeated failed admin logins before password hashing can be abused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-login-rate-'));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}/admin/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rate-limit-admin', password: `wrong-${attempt}` }),
    });
    expect(response.status).toBe(401);
  }

  const limited = await fetch(`${baseUrl}/admin/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'rate-limit-admin', password: 'wrong-final' }),
  });
  const body = await limited.json();

  expect(limited.status).toBe(429);
  expect(body.error.code).toBe('RATE_LIMITED');
});
```

Add this logout/session invalidation test:

```ts
it('invalidates bootstrapped file-store admin session tokens on logout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-logout-'));
  server = createApp({
    config: testConfig({
      enableAdminRoutes: true,
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const loginResponse = await fetch(`${baseUrl}/admin/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'changeme' }),
  });
  const loginBody = await loginResponse.json();
  expect(loginResponse.status).toBe(200);
  expect(loginBody.token).toMatch(/^adm_/);

  const logoutResponse = await fetch(`${baseUrl}/admin/api/auth/logout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${loginBody.token}` },
  });
  expect(logoutResponse.status).toBe(200);

  const healthResponse = await fetch(`${baseUrl}/admin/api/health`, {
    headers: { authorization: `Bearer ${loginBody.token}` },
  });
  expect(healthResponse.status).toBe(401);
});
```

Add this credential path sanitization assertion to the existing file-store import/list/detail test after importing a service account credential:

```ts
const credentialsResponse = await fetch(`${baseUrl}/admin/api/vertex-credentials`, {
  headers: { authorization: 'Bearer admin-secret' },
});
const credentialsBody = await credentialsResponse.json();
expect(credentialsBody.vertexPools[0].credentialsFile).toBeNull();
expect(credentialsBody.vertexPools[0].fileName).toBeUndefined();
expect(JSON.stringify(credentialsBody)).not.toContain(dir);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- test/admin-routes.test.ts`

Expected before implementation:

- Failed login attempts keep returning `401` instead of `429`.
- `/admin/api/auth/logout` returns `404`.
- Credential responses still contain the absolute file-store directory.

- [ ] **Step 3: Add rate-limit error code**

In `src/http/error-response.ts`, add the union member:

```ts
| 'RATE_LIMITED'
```

- [ ] **Step 4: Persist session creation time**

In `src/config/admin-settings-store.ts`, extend `AdminFileStoreSettings`:

```ts
export interface AdminFileStoreSettings {
  adminToken?: string | null;
  adminSessionToken?: string | null;
  adminSessionTokenCreatedAt?: string | null;
  adminUsername?: string | null;
  adminPasswordHash?: string | null;
  adminPasswordChangedAt?: string | null;
}
```

- [ ] **Step 5: Add login throttling helpers**

In `src/admin/admin-routes.ts`, add these constants and helpers near `createAdminSessionToken`:

```ts
const ADMIN_LOGIN_WINDOW_MS = 60_000;
const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface LoginAttemptState {
  readonly firstFailureAt: number;
  readonly failures: number;
}

const rateLimiter = createAdminLoginRateLimiter({
  windowMs: ADMIN_LOGIN_WINDOW_MS,
  maxFailures: ADMIN_LOGIN_MAX_FAILURES,
});

const assertAdminLoginAllowed = (req: IncomingMessage, username: string): void => {
  rateLimiter.assertAllowed(req, username);
};

const recordAdminLoginFailure = (req: IncomingMessage, username: string): void => {
  rateLimiter.recordFailure(req, username);
};

const clearAdminLoginFailures = (req: IncomingMessage, username: string): void => {
  rateLimiter.clearFailures(req, username);
};
```

- [ ] **Step 6: Add session TTL and logout helpers**

In `src/admin/admin-routes.ts`, add these helpers near `ensureAdminSessionToken`:

```ts
const isFreshAdminSessionToken = (createdAt: string | null | undefined): boolean => {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  return Number.isFinite(createdMs) && Date.now() - createdMs <= ADMIN_SESSION_TTL_MS;
};

const activateNullableAdminToken = (
  config: GatewayConfig,
  adminToken: string | null,
  runtime?: GenAiRuntimeLike,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): void => {
  const nextConfig = createDerivedConfig(config, { adminToken });
  onConfigReload?.(nextConfig);
  if (!onConfigReload) runtime?.reload(nextConfig);
};
```

Replace `ensureAdminSessionToken` with:

```ts
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
  if (existingSessionToken && isFreshAdminSessionToken(settings.adminSessionTokenCreatedAt)) {
    activateAdminToken(config, existingSessionToken, runtime, onConfigReload);
    return existingSessionToken;
  }
  if (!canBootstrapAdminToken(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Admin session token bootstrap is not available.');
  }
  const adminSessionToken = createAdminSessionToken();
  persistAdminFileStoreSettings(config, {
    adminSessionToken,
    adminSessionTokenCreatedAt: new Date().toISOString(),
  });
  activateAdminToken(config, adminSessionToken, runtime, onConfigReload);
  return adminSessionToken;
};
```

When password change rotates a session token, persist the creation timestamp:

```ts
...(shouldRotateSessionToken ? {
  adminSessionToken: nextToken,
  adminSessionTokenCreatedAt: new Date().toISOString(),
} : {}),
```

- [ ] **Step 7: Apply throttling in login and add logout route**

In the `/admin/api/auth/login` route, after parsing username/password and before `verifyAdminPasswordLogin`, add:

```ts
assertAdminLoginAllowed(req, username);
```

Replace the failed-login block with:

```ts
if (!login) {
  recordAdminLoginFailure(req, username);
  throw new GatewayError(401, 'AUTH_INVALID', 'Admin login failed.');
}
clearAdminLoginFailures(req, username);
```

After `requireAdminAuth(req.headers, config);` and before password change handling, add:

```ts
if (req.method === 'POST' && normalizedPathname === '/admin/api/auth/logout') {
  const settings = readAdminFileStoreSettings(config);
  const sessionToken = typeof settings.adminSessionToken === 'string'
    ? settings.adminSessionToken.trim()
    : '';
  if (config.adminToken && sessionToken && config.adminToken === sessionToken) {
    persistAdminFileStoreSettings(config, {
      adminSessionToken: null,
      adminSessionTokenCreatedAt: null,
    });
    activateNullableAdminToken(config, null, runtime, onConfigReload);
  }
  sendJson(res, 200, { ok: true });
  return true;
}
```

- [ ] **Step 8: Sanitize credential file paths in admin responses**

In `src/admin/admin-routes.ts`, change `SanitizedCredentialRecord`:

```ts
import path from 'node:path';
```

Keep the existing `node:fs` import, and add the `node:path` import near the top of the file.

Then change `SanitizedCredentialRecord`:

```ts
type SanitizedCredentialRecord = Omit<AdminVertexCredentialRecord, 'apiKey' | 'credentialsFile'> & {
  credentialsFile: null;
  hasApiKey: boolean;
  health?: GenAiTargetHealth;
};
```

Replace `redactApiKey` with:

```ts
const redactCredentialForAdmin = <T extends { apiKey?: string | null; credentialsFile?: string | null }>(
  entry: T,
): Omit<T, 'apiKey' | 'credentialsFile'> & { credentialsFile: null; hasApiKey: boolean } => {
  const { apiKey: _apiKey, credentialsFile: _credentialsFile, ...rest } = entry;
  return {
    ...rest,
    credentialsFile: null,
    hasApiKey: Boolean(_apiKey),
  };
};
```

Update `withRuntimeHealth` to call `redactCredentialForAdmin`:

```ts
vertexPools: snapshot.vertexPools.map((entry) => redactCredentialForAdmin({
  ...entry,
  ...(healthById.get(entry.id) ? { health: healthById.get(entry.id) } : {}),
})),
```

For file-store deletion, do not depend on the sanitized response. The route already uses `findCredentialOrThrow(credentialStore.getSnapshot(), id)` before deleting, so keep that behavior.

- [ ] **Step 9: Keep frontend credential type aligned with the sanitized backend contract**

Ensure `frontend/src/types/admin.ts` and `frontend/src/lib/admin-dashboard-api.ts` do **not** include `fileName` in `VertexTargetRow`, `AdminVertexCredentialRecord`, or `mapVertexTarget`.

- [ ] **Step 10: Verify task**

Run:

```bash
npm test -- test/admin-routes.test.ts
npm run compile
cd frontend
npm run build
```

Expected:

- Login throttle test returns `429 RATE_LIMITED`.
- Logout invalidates bootstrapped file-store session tokens.
- Credential list/detail responses no longer contain the absolute file-store directory.
- TypeScript accepts sanitized credential shapes.

- [ ] **Step 11: Commit**

```bash
git add src/http/error-response.ts src/config/admin-settings-store.ts src/admin/admin-routes.ts test/admin-routes.test.ts frontend/src/types/admin.ts frontend/src/lib/admin-dashboard-api.ts
git commit -m "fix: harden admin auth sessions"
```

### Task 3: Pass Authenticated Admin Token Into Child Views

**Files:**
- Modify: `frontend/src/pages/AdminApp.tsx`
- Modify: `frontend/src/pages/AIProvidersView.tsx`
- Modify: `frontend/src/pages/AuthFilesView.tsx`
- Modify: `frontend/src/pages/AvailableModelsView.tsx`
- Modify: `frontend/src/pages/ModelManagementView.tsx`
- Modify: `frontend/src/lib/admin-dashboard-api.ts`

- [ ] **Step 1: Update `AdminApp` view routing**

First add a logout helper to `frontend/src/lib/admin-dashboard-api.ts`:

```ts
export async function logoutAdmin(options: AdminApiOptions): Promise<void> {
  await adminFetch<{ ok: true }>('/admin/api/auth/logout', options, { method: 'POST' });
}
```

Then import it in `frontend/src/pages/AdminApp.tsx`:

```tsx
import { changeAdminPassword, loginAdmin, logoutAdmin } from '@/lib/admin-dashboard-api';
```

Add this handler inside `AdminApp`:

```tsx
const handleLogout = async () => {
  if (token) {
    try {
      await logoutAdmin({ token });
    } catch {
      // Local logout should still complete if the token was already expired server-side.
    }
  }
  setToken('');
  setMustChangePassword(false);
};
```

Replace the logout button:

```tsx
<Button variant="secondary" size="sm" onClick={() => { void handleLogout(); }}>Logout</Button>
```

Change `renderView` in `frontend/src/pages/AdminApp.tsx` to accept the active token and pass it to data/mutation views:

```tsx
function renderView(view: AdminViewId, adminData: ReturnType<typeof useAdminDashboardData>, token: string) {
  switch (view) {
    case 'dashboard':
      return <Dashboard adminData={adminData} />;
    case 'ai-providers':
      return <AIProvidersView adminData={adminData} token={token} />;
    case 'auth-files':
      return <AuthFilesView adminData={adminData} token={token} />;
    case 'available-models':
      return <AvailableModelsView token={token} />;
    case 'logs-viewer':
      return <LogsViewerView />;
    case 'model-management':
      return <ModelManagementView token={token} />;
    default:
      return <Dashboard adminData={adminData} />;
  }
}
```

Change the render call at the bottom:

```tsx
{isAuthenticated && renderView(view, adminData, token)}
```

- [ ] **Step 2: Update `AIProvidersView` props and refresh after tests**

Remove the `useAdminToken` import from `frontend/src/pages/AIProvidersView.tsx`.

Use this props interface and function signature:

```tsx
interface AIProvidersViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
}

export function AIProvidersView({ adminData, token }: AIProvidersViewProps) {
```

Update `handleTest`:

```tsx
const handleTest = async (id: string) => {
  setActionError(null);
  try {
    await testVertexCredential({ token }, id);
    await adminData.refetch();
  } catch (error) {
    setActionError(error instanceof Error ? error.message : 'Test failed');
  }
};
```

- [ ] **Step 3: Wire `AuthFilesView` credential lifecycle actions**

Replace `frontend/src/pages/AuthFilesView.tsx` with:

```tsx
import { useState } from 'react';
import { AdminError, EmptyState, TableSkeleton } from '@/components/console/AdminState';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import {
  deleteVertexCredential,
  testVertexCredential,
  updateVertexCredential,
  type VertexTargetPatchPayload,
} from '@/lib/admin-dashboard-api';

interface AuthFilesViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
}

export function AuthFilesView({ adminData, token }: AuthFilesViewProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const saTargets = adminData.vertexTargets.filter((target) => target.authType === 'Service Account JSON');

  const handleTest = async (id: string) => {
    setActionError(null);
    try {
      await testVertexCredential({ token }, id);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Test failed');
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteVertexCredential({ token }, id);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const handleUpdate = async (id: string, patch: VertexTargetPatchPayload) => {
    setActionError(null);
    try {
      await updateVertexCredential({ token }, id, patch);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Auth Files</h1>
        <p className="mt-1 text-sm text-muted-foreground">Service account credentials used by the gateway for upstream Google API calls.</p>
      </section>

      {(adminData.error || actionError) && (
        <AdminError message={actionError ?? adminData.error ?? ''} onRetry={() => { setActionError(null); adminData.refetch(); }} />
      )}

      {adminData.loading ? (
        <TableSkeleton rows={3} columns={6} />
      ) : saTargets.length === 0 ? (
        <EmptyState title="No service account targets" body="All targets use API key authentication. Add a service account via AI Providers view." />
      ) : (
        <VertexTargetsTable
          rows={saTargets}
          onTest={handleTest}
          onDelete={adminData.mutable ? handleDelete : undefined}
          onUpdate={adminData.mutable ? handleUpdate : undefined}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify task**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected:

- `npm run lint` passes with no unused `useAdminToken` imports in child views.
- `npm run build` passes type checking.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/admin-dashboard-api.ts frontend/src/pages/AdminApp.tsx frontend/src/pages/AIProvidersView.tsx frontend/src/pages/AuthFilesView.tsx
git commit -m "fix: share admin token with child views"
```

### Task 4: Correct Model Catalog Views And Editor State

**Files:**
- Modify: `frontend/src/pages/AvailableModelsView.tsx`
- Modify: `frontend/src/pages/ModelManagementView.tsx`
- Modify: `frontend/src/components/console/ModelCatalogEditor.tsx`

- [ ] **Step 1: Replace `AvailableModelsView` with all-provider inventory**

Replace `frontend/src/pages/AvailableModelsView.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fetchModelCatalog } from '@/lib/admin-dashboard-api';
import type { ProviderModelCatalog } from '@/types/admin';

const PROVIDERS = ['gemini', 'openai'] as const;

interface AvailableModelsViewProps {
  readonly token: string;
}

interface CatalogModelRow {
  readonly provider: string;
  readonly model: string;
  readonly status: 'allowed' | 'disabled';
  readonly aliases: readonly string[];
  readonly isDefault: boolean;
}

const buildRows = (provider: string, catalog: ProviderModelCatalog): CatalogModelRow[] => {
  const statuses = new Map<string, 'allowed' | 'disabled'>();
  for (const model of catalog.allowlist ?? []) statuses.set(model, 'allowed');
  for (const model of catalog.defaultModel ? [catalog.defaultModel] : []) {
    if (!statuses.has(model)) statuses.set(model, 'allowed');
  }
  for (const model of Object.values(catalog.aliases ?? {})) {
    if (!statuses.has(model)) statuses.set(model, 'allowed');
  }
  for (const model of catalog.disabled ?? []) statuses.set(model, 'disabled');

  return Array.from(statuses.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, status]) => ({
      provider,
      model,
      status,
      aliases: Object.entries(catalog.aliases ?? {})
        .filter(([, target]) => target === model)
        .map(([alias]) => alias)
        .sort(),
      isDefault: catalog.defaultModel === model,
    }));
};

export function AvailableModelsView({ token }: AvailableModelsViewProps) {
  const [catalogs, setCatalogs] = useState<Record<string, ProviderModelCatalog>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        PROVIDERS.map(async (provider) => [provider, await fetchModelCatalog({ token }, provider)] as const),
      );
      setCatalogs(Object.fromEntries(results));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => PROVIDERS.flatMap((provider) => buildRows(provider, catalogs[provider] ?? { aliases: {}, allowlist: [], disabled: [] })),
    [catalogs],
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Available Models</h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only inventory of the current model catalog.</p>
      </section>

      {error && <AdminError message={error} onRetry={load} />}

      {loading ? (
        <TableSkeleton rows={5} columns={5} />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Aliases</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length > 0 ? (
                rows.map((row) => (
                  <TableRow key={`${row.provider}:${row.model}`}>
                    <TableCell className="font-medium">{row.provider}</TableCell>
                    <TableCell className="font-mono text-sm">{row.model}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'allowed' ? 'default' : 'destructive'}>{row.status}</Badge>
                    </TableCell>
                    <TableCell>{row.isDefault ? 'Yes' : '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{row.aliases.join(', ') || '-'}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">No catalog rules configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Hide editable model editors after load failure**

In `frontend/src/pages/ModelManagementView.tsx`, remove the `useAdminToken` import, add token props, and change the render logic:

```tsx
interface ModelManagementViewProps {
  readonly token: string;
}

export function ModelManagementView({ token }: ModelManagementViewProps) {
```

Replace the body area after the heading section with:

```tsx
{error && <AdminError message={error} onRetry={load} />}

{loading ? (
  <TableSkeleton rows={4} columns={2} />
) : error ? null : (
  PROVIDERS.map((provider) => (
    <ModelCatalogEditor
      key={provider}
      provider={provider}
      catalog={catalogs[provider] ?? { aliases: {}, allowlist: [], disabled: [] }}
      onSave={(catalog) => handleSave(provider, catalog)}
    />
  ))
)}
```

- [ ] **Step 3: Sync `ModelCatalogEditor` state and use shared `Textarea`**

Modify imports in `frontend/src/components/console/ModelCatalogEditor.tsx`:

```tsx
import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AdminError } from '@/components/console/AdminState';
import type { ProviderModelCatalog } from '@/types/admin';
```

Initialize aliases defensively and add this sync effect after state declarations:

```tsx
const [defaultModel, setDefaultModel] = useState(catalog.defaultModel ?? '');
const [aliasesJson, setAliasesJson] = useState(JSON.stringify(catalog.aliases ?? {}, null, 2));
const [allowlistCsv, setAllowlistCsv] = useState((catalog.allowlist ?? []).join(', '));
const [disabledCsv, setDisabledCsv] = useState((catalog.disabled ?? []).join(', '));
const [saving, setSaving] = useState(false);
const [error, setError] = useState<string | null>(null);

useEffect(() => {
  setDefaultModel(catalog.defaultModel ?? '');
  setAliasesJson(JSON.stringify(catalog.aliases ?? {}, null, 2));
  setAllowlistCsv((catalog.allowlist ?? []).join(', '));
  setDisabledCsv((catalog.disabled ?? []).join(', '));
}, [catalog]);
```

Replace the raw `textarea` with:

```tsx
<Textarea
  className="mt-1.5 font-mono"
  rows={4}
  value={aliasesJson}
  onChange={(e) => setAliasesJson(e.target.value)}
/>
```

Tighten JSON parsing in `handleSave`:

```tsx
let aliases: Record<string, string>;
try {
  const parsed = JSON.parse(aliasesJson) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid aliases JSON');
  }
  aliases = Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
} catch {
  throw new Error('Invalid aliases JSON');
}
```

- [ ] **Step 4: Verify task**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected:

- TypeScript accepts the new token props.
- The shared `Textarea` import is used.
- No duplicate React key warning exists in the `AvailableModelsView` implementation because keys include provider and model.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AvailableModelsView.tsx frontend/src/pages/ModelManagementView.tsx frontend/src/components/console/ModelCatalogEditor.tsx
git commit -m "fix: correct admin model catalog views"
```

### Task 5: Correct Runtime Health And Reload Staleness

**Files:**
- Modify: `frontend/src/lib/admin-dashboard-api.ts`
- Modify: `frontend/src/hooks/useAdminDashboardData.ts`

- [ ] **Step 1: Count only actionable degraded target states**

In `frontend/src/lib/admin-dashboard-api.ts`, add this helper above `fetchAdminHealth`:

```ts
const isActionableDegradedStatus = (status: string | undefined): boolean =>
  status === 'cooldown' || status === 'failed';
```

Replace the `degradedTargets` line in `fetchAdminHealth`:

```ts
degradedTargets: targets.filter((target) => isActionableDegradedStatus(target.health?.status)).length,
```

- [ ] **Step 2: Guard `reload()` against stale token updates**

In `frontend/src/hooks/useAdminDashboardData.ts`, add a token ref near `refreshSequence`:

```ts
const tokenRef = useRef(token);

useEffect(() => {
  tokenRef.current = token;
  refreshSequence.current += 1;
}, [token]);
```

Replace `reload` with:

```ts
const reload = useCallback(async () => {
  if (!token) return;
  const sequence = refreshSequence.current + 1;
  const tokenAtStart = token;
  refreshSequence.current = sequence;
  try {
    const health = await reloadRuntime(options);
    if (refreshSequence.current !== sequence || tokenRef.current !== tokenAtStart) return;
    setState((current) => ({ ...current, health }));
    await refresh();
  } catch (error) {
    if (refreshSequence.current !== sequence || tokenRef.current !== tokenAtStart) return;
    setState((current) => ({ ...current, error: errorMessage(error, 'Failed to reload runtime') }));
  }
}, [options, refresh, token]);
```

- [ ] **Step 3: Verify task**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected:

- No hook dependency warning or type error.
- `reload` no longer mutates state after token changes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/admin-dashboard-api.ts frontend/src/hooks/useAdminDashboardData.ts
git commit -m "fix: correct admin runtime health state"
```

### Task 6: Full Verification And PR Thread Closeout Prep

**Files:**
- No code changes expected unless validation exposes a regression.

- [ ] **Step 1: Run backend compile**

Run:

```bash
npm run compile
```

Expected: TypeScript compile completes successfully.

- [ ] **Step 2: Run focused backend tests**

Run:

```bash
npm test -- test/admin-routes.test.ts test/admin-ui.test.ts
```

Expected: focused admin tests pass without requiring a pre-existing `frontend/dist`.

- [ ] **Step 3: Run full backend test suite**

Run:

```bash
npm test
```

Expected: full Vitest suite passes.

- [ ] **Step 4: Run frontend checks**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: oxlint and Vite production build pass.

- [ ] **Step 5: Verify Docker packaging**

Run from repo root:

```bash
docker build -t vertex-gateway-admin-spa-review-fix .
```

Expected: Docker build passes and the final image contains `frontend/dist`.

- [ ] **Step 6: Prepare GitHub review-thread summary**

Use this summary when reporting back before any GitHub write action:

```text
Resolved by code:
- Docker image now builds and copies the React admin SPA.
- Admin asset serving rejects malformed paths/directories and handles stream errors.
- Admin child views receive the authenticated token from AdminApp.
- AI Providers and Auth Files lifecycle actions use the active token and refresh after mutations/tests.
- Model catalog inventory covers Gemini/OpenAI, default models, alias targets, and disabled precedence without duplicate keys.
- Model Management does not render editable empty fallback catalogs after load failures.
- ModelCatalogEditor syncs local fields when catalog props change and uses the shared Textarea component.
- Runtime badges exclude disabled/unknown targets from actionable degraded counts.
- Runtime reload ignores stale responses after logout/token changes.
- Admin route tests no longer depend on an existing frontend build artifact.
- Admin login is throttled after repeated failures.
- File-store admin logout invalidates bootstrapped session tokens and session tokens have a TTL.
- The React logout action calls the server logout endpoint before clearing client state.
- Admin credential responses expose neither absolute service-account paths nor derived file names.

Intentionally not changed:
- Full-page refresh during forced password change still returns to login because the admin token is intentionally memory-only.
- Create/import form data is already preserved on API failures because mutation callbacks rethrow and dialogs reset only after success.
- Frontend unit test coverage is tracked as a follow-up, not a PR #8 blocker.
```

- [ ] **Step 7: Commit verification-only fixes if needed**

If validation required additional code edits, stage only those paths and commit:

```bash
git add <changed-files>
git commit -m "test: cover admin react review fixes"
```

If validation required no additional code edits, do not create an empty commit.

## Self-Review Checklist

- Spec coverage: every valid PR #8 review finding listed in "Review Finding Scope" maps to Task 1, 2, 3, 4, or 5.
- Placeholder scan: this plan contains no forbidden placeholder markers or unspecified implementation steps.
- Type consistency: child view props use `token: string`; credential patch handlers use `VertexTargetPatchPayload`; catalog rows use `ProviderModelCatalog`; runtime health uses raw backend health statuses.
- Validation coverage: backend compile, focused backend tests, full backend tests, frontend lint, frontend build, and Docker build are all included.
