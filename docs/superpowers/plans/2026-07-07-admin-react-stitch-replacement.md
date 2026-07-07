# Admin React Stitch Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live backend-rendered `/admin` page with the React Stitch-aligned admin app while preserving the existing `/admin/api/*` contract.

**Architecture:** The backend keeps ownership of auth, persistence, runtime reload, and admin JSON APIs. The frontend becomes the only presentation layer for `/admin`, with query-param view routing, typed admin API functions, live-backed tables, and explicit beta screens for telemetry that does not have a backend source. The old `renderAdminUi()` stays available only as inactive rollback code until a follow-up deletion is approved.

**Tech Stack:** Node.js 22, TypeScript, Vitest, React 19, Vite 8, Tailwind v4, Radix Dialog/Select, lucide-react, oxlint.

---

## File Structure

- Create `src/admin/admin-spa.ts`: resolve `frontend/dist`, serve `index.html`, serve `/admin/assets/*`, set safe content types, and keep admin asset serving separate from `/admin/api/*`.
- Modify `src/admin/admin-routes.ts`: replace `renderAdminUi()` for `GET /admin` with the React SPA shell and add static asset handling for `/admin/assets/*`.
- Modify `test/admin-ui.test.ts`: stop asserting old beige/static UI sections as the active route source; keep a narrow legacy-render test only if the helper remains exported.
- Modify `test/admin-routes.test.ts`: cover `/admin` serving the React root, `/admin/assets/*` serving built assets, `/admin/api/*` remaining JSON, and old static UI markers not appearing on the live route.
- Modify `frontend/vite.config.ts`: set `base: '/admin/'` so production assets resolve under `/admin/assets/*`.
- Create `frontend/src/types/admin.ts`: shared frontend-only shapes for admin views, gateway keys, Vertex credentials, health, runtime, model catalogs, and mutation states.
- Replace `frontend/src/data/mockData.ts` with `frontend/src/data/admin-static.ts`: retain only non-live static labels/notices; remove fake KPI/log rows from live screens.
- Modify `frontend/src/lib/admin-dashboard-api.ts`: expand typed functions for health, credentials inspect/update/delete/test, model catalog load/save, and runtime reload.
- Modify `frontend/src/hooks/useAdminDashboardData.ts`: load health, gateway keys, Vertex credentials, and model catalog data; expose refresh and mutation actions with scoped errors.
- Create `frontend/src/hooks/useAdminView.ts`: parse and set `?view=` values for shareable deep links.
- Modify `frontend/src/components/stitch/StitchConsoleShell.tsx`: turn the current narrow shell into a real fixed-nav admin shell with six views, topbar badges, and logout/actions.
- Create `frontend/src/components/console/AdminState.tsx`: loading skeleton rows, empty state, scoped error block, and beta state components.
- Create `frontend/src/components/console/RuntimeBadges.tsx`: readiness, runtime mode, admin store mode, and mutation-state badges.
- Modify `frontend/src/components/console/GatewayKeysTable.tsx`: keep gateway key list live-backed, mono secret previews, scoped pending/error states, and revoke actions.
- Modify `frontend/src/components/console/VertexTargetsTable.tsx`: add inspect, test, edit, delete actions while preserving secret redaction.
- Create `frontend/src/pages/AdminApp.tsx`: auth gate, password-change gate, main shell, and view switch.
- Replace `frontend/src/pages/Dashboard.tsx`: make it a live overview screen only.
- Create `frontend/src/pages/AIProvidersView.tsx`: operational target health and routing capacity screen.
- Create `frontend/src/pages/AuthFilesView.tsx`: upstream credential lifecycle screen.
- Create `frontend/src/pages/AvailableModelsView.tsx`: read-heavy model catalog inventory.
- Create `frontend/src/pages/LogsViewerView.tsx`: finished beta layout with disabled/read-only telemetry controls.
- Create `frontend/src/pages/ModelManagementView.tsx`: editable model defaults, aliases, allowlist, and disabled entries.
- Modify `frontend/src/App.tsx`: render `AdminApp` instead of `Dashboard`.

### Task 1: Serve the React Admin SPA From `/admin`

**Files:**
- Create: `src/admin/admin-spa.ts`
- Modify: `src/admin/admin-routes.ts`
- Modify: `frontend/vite.config.ts`
- Test: `test/admin-routes.test.ts`
- Test: `test/admin-ui.test.ts`

- [ ] **Step 1: Write failing backend route tests**

Add this test to `test/admin-routes.test.ts` inside the admin route suite. Use the existing `createApp`, `listen`, `server`, `testConfig`, and fake runtime helpers already present in that file.

```ts
it('serves the React admin shell at /admin without exposing the old static admin UI', async () => {
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin`);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/html');
  expect(html).toContain('<div id="root"></div>');
  expect(html).toContain('/admin/assets/');
  expect(html).not.toContain('Vertex JSON Login');
  expect(html).not.toContain('id="log-search"');
});
```

Add the API stability assertion:

```ts
it('keeps /admin/api routes JSON-backed after the SPA replacement', async () => {
  server = createApp({
    config: testConfig({ enableAdminRoutes: true, adminToken: 'admin-secret' }),
    runtimeFactory: () => createFakeRuntime(),
  });
  const baseUrl = await listen(server);

  const response = await fetch(`${baseUrl}/admin/api/health`, {
    headers: { authorization: 'Bearer admin-secret' },
  });
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.runtime).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/admin-routes.test.ts`

Expected: the new `/admin` route test fails because the current route still returns `renderAdminUi()` output.

- [ ] **Step 3: Configure Vite asset base**

Modify `frontend/vite.config.ts`:

```ts
export default defineConfig({
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Add SPA asset serving helper**

Create `src/admin/admin-spa.ts`:

```ts
import { createReadStream, existsSync } from 'node:fs';
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
  const relative = decodeURIComponent(pathname.slice(ADMIN_ASSET_PREFIX.length));
  const resolved = path.resolve(FRONTEND_DIST, 'assets', relative);
  const assetRoot = path.resolve(FRONTEND_DIST, 'assets');
  if (!resolved.startsWith(`${assetRoot}${path.sep}`)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Invalid admin asset path.');
  }
  return resolved;
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
  if (!existsSync(assetPath)) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin asset is not found.');
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypes[path.extname(assetPath)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  createReadStream(assetPath).pipe(res);
  return true;
};
```

- [ ] **Step 5: Replace live `/admin` rendering**

Modify `src/admin/admin-routes.ts` imports:

```ts
import { renderAdminSpa, serveAdminAsset } from './admin-spa.js';
```

Remove the active `renderAdminUi` import from `admin-routes.ts`.

Add this branch before the `GET /admin` branch:

```ts
if (req.method === 'GET' && serveAdminAsset(normalizedPathname, res)) {
  return true;
}
```

Replace the current `GET /admin` branch:

```ts
if (req.method === 'GET' && normalizedPathname === '/admin') {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(await renderAdminSpa());
  return true;
}
```

- [ ] **Step 6: Narrow the legacy UI test**

Modify `test/admin-ui.test.ts` so it no longer defines the live route contract. Keep only a helper-level legacy assertion:

```ts
describe('legacy admin ui renderer', () => {
  it('still renders the rollback shell while it remains in the repository', () => {
    const html = renderAdminUi();

    expect(html).toContain('Gateway Admin');
    expect(html).toContain('Auth Files');
    expect(html).toContain('Vertex / Gemini');
    expect(html).not.toContain('/download');
    expect(html).not.toContain('gpt-5.5');
  });
});
```

- [ ] **Step 7: Build frontend and run backend tests**

Run: `cd frontend && npm run build`

Expected: Vite emits `frontend/dist/index.html` with `/admin/assets/` script and stylesheet URLs.

Run: `npm test -- test/admin-routes.test.ts test/admin-ui.test.ts`

Expected: all selected tests pass.

Run: `npm run compile`

Expected: backend TypeScript compile succeeds.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/admin/admin-spa.ts src/admin/admin-routes.ts frontend/vite.config.ts test/admin-routes.test.ts test/admin-ui.test.ts
git commit -m "feat: serve react admin app at admin route"
```

### Task 2: Define Admin Frontend Types And Static Copy

**Files:**
- Create: `frontend/src/types/admin.ts`
- Create: `frontend/src/data/admin-static.ts`
- Modify: `frontend/src/data/mockData.ts`
- Modify: `frontend/src/lib/admin-dashboard-api.ts`
- Modify: `frontend/src/components/console/GatewayKeysTable.tsx`
- Modify: `frontend/src/components/console/VertexTargetsTable.tsx`

- [ ] **Step 1: Create shared admin types**

Create `frontend/src/types/admin.ts`:

```ts
export type AdminViewId =
  | 'dashboard'
  | 'ai-providers'
  | 'auth-files'
  | 'available-models'
  | 'logs-viewer'
  | 'model-management';

export type AdminStoreMode = 'static-config' | 'file-store';
export type VertexHealth = 'ready' | 'degraded' | 'failed' | 'disabled' | 'unknown';

export interface GatewayKeyRow {
  readonly id: string;
  readonly label: string;
  readonly preview: string;
  readonly status: 'active' | 'revoked';
  readonly createdAt: string;
  readonly revokedAt?: string;
}

export interface VertexTargetRow {
  readonly id: string;
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly authType: 'Google Cloud API key' | 'Service Account JSON';
  readonly apiKeyMode: 'full' | 'express';
  readonly enabled: boolean;
  readonly weight: number;
  readonly modelAllowlist: readonly string[];
  readonly modelExclusions: readonly string[];
  readonly credentialsFile: string | null;
  readonly hasApiKey: boolean;
  readonly email?: string;
  readonly health: VertexHealth;
}
```

Continue the same file:

```ts
export interface RuntimeHealthSummary {
  readonly ok: boolean;
  readonly service: string;
  readonly mode: AdminStoreMode;
  readonly runtimeMode: string;
  readonly targetCount: number;
  readonly healthyTargets: number;
  readonly degradedTargets: number;
}

export interface ProviderModelCatalog {
  readonly defaultModel?: string;
  readonly aliases: Record<string, string>;
  readonly allowlist: readonly string[];
  readonly disabled: readonly string[];
}

export interface AdminScopedError {
  readonly area: string;
  readonly message: string;
}
```

- [ ] **Step 2: Move non-live static content out of `mockData.ts`**

Create `frontend/src/data/admin-static.ts`:

```ts
import type { AdminViewId } from '@/types/admin';

export interface AdminNavItem {
  readonly id: AdminViewId;
  readonly label: string;
  readonly description: string;
}

export const adminNavItems: readonly AdminNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Runtime posture' },
  { id: 'ai-providers', label: 'AI Providers', description: 'Vertex targets' },
  { id: 'auth-files', label: 'Auth Files', description: 'Upstream credentials' },
  { id: 'available-models', label: 'Available Models', description: 'Catalog inventory' },
  { id: 'logs-viewer', label: 'Logs Viewer', description: 'Telemetry beta' },
  { id: 'model-management', label: 'Model Management', description: 'Routing policy' },
];

export const securityNotices = [
  'Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.',
  'Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client.',
  'Wildcard CORS không phù hợp cho production.',
] as const;
```

Modify `frontend/src/data/mockData.ts` to remove exports of `apiLogs`, `gatewayKeys`, `vertexTargets`, and `kpiMetrics`. If no imports remain after this task, delete `mockData.ts` in Task 8 after validation confirms it is unused.

- [ ] **Step 3: Update imports to the new types**

In `frontend/src/lib/admin-dashboard-api.ts`, replace:

```ts
import type { GatewayKeyRow, VertexTargetRow } from '@/data/mockData';
```

with:

```ts
import type { GatewayKeyRow, ProviderModelCatalog, RuntimeHealthSummary, VertexTargetRow } from '@/types/admin';
```

In `GatewayKeysTable.tsx` and `VertexTargetsTable.tsx`, replace `@/data/mockData` type imports with:

```ts
import type { GatewayKeyRow } from '@/types/admin';
```

and:

```ts
import type { VertexTargetRow } from '@/types/admin';
```

- [ ] **Step 4: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: fail only if a removed mock export is still imported.

Fix any import by replacing fake data usage with live state or an explicit beta state from later tasks.

Run again: `cd frontend && npm run build`

Expected: pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add frontend/src/types/admin.ts frontend/src/data/admin-static.ts frontend/src/data/mockData.ts frontend/src/lib/admin-dashboard-api.ts frontend/src/components/console/GatewayKeysTable.tsx frontend/src/components/console/VertexTargetsTable.tsx
git commit -m "refactor: define admin frontend data contracts"
```

### Task 3: Expand The Typed Admin API Client

**Files:**
- Modify: `frontend/src/lib/admin-dashboard-api.ts`
- Modify: `frontend/src/lib/admin-api.ts`

- [ ] **Step 1: Improve admin error parsing**

Modify `frontend/src/lib/admin-api.ts`:

```ts
const parseAdminError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    const code = body.error?.code ? `${body.error.code}: ` : '';
    return `${response.status} ${code}${body.error?.message ?? response.statusText}`.trim();
  } catch {
    return `${response.status} ${response.statusText} ${text}`.trim();
  }
};
```

Replace the current `!response.ok` branch:

```ts
if (!response.ok) {
  throw new Error(`Admin API failed: ${await parseAdminError(response)}`);
}
```

- [ ] **Step 2: Expand response types and mappers**

In `frontend/src/lib/admin-dashboard-api.ts`, define the sanitized backend record:

```ts
interface AdminVertexCredentialRecord {
  readonly id: string;
  readonly label?: string;
  readonly project: string;
  readonly location: string;
  readonly credentialsFile: string | null;
  readonly hasApiKey: boolean;
  readonly apiKeyMode: 'full' | 'express';
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelAllowlist?: readonly string[];
  readonly modelExclusions?: readonly string[];
  readonly email?: string;
  readonly health?: { readonly status?: string };
}

interface VertexCredentialsResponse {
  readonly vertexPools: readonly AdminVertexCredentialRecord[];
}
```

Replace `mapHealth` and `mapVertexTarget`:

```ts
const mapHealth = (record: AdminVertexCredentialRecord): VertexTargetRow['health'] => {
  if (record.health?.status === 'healthy') return 'ready';
  if (record.health?.status === 'cooldown') return 'degraded';
  if (record.health?.status === 'disabled') return 'disabled';
  if (record.health?.status === 'failed') return 'failed';
  return 'unknown';
};

export const mapVertexTarget = (record: AdminVertexCredentialRecord): VertexTargetRow => ({
  id: record.id,
  label: record.label ?? record.id,
  project: record.project,
  location: record.location,
  authType: record.hasApiKey ? 'Google Cloud API key' : 'Service Account JSON',
  apiKeyMode: record.apiKeyMode,
  enabled: record.enabled !== false,
  weight: record.weight ?? 1,
  modelAllowlist: record.modelAllowlist ?? [],
  modelExclusions: record.modelExclusions ?? [],
  credentialsFile: record.credentialsFile,
  hasApiKey: record.hasApiKey,
  email: record.email,
  health: mapHealth(record),
});
```

- [ ] **Step 3: Add health, credential, model, and reload functions**

Add these API functions:

```ts
export async function fetchAdminHealth(options: AdminApiOptions): Promise<RuntimeHealthSummary> {
  const response = await adminFetch<{
    ok: true;
    service: string;
    mode: RuntimeHealthSummary['mode'];
    runtime: { mode?: string; active?: { targets?: Array<{ health?: { status?: string } }> } };
  }>('/admin/api/health', options);
  const targets = response.runtime.active?.targets ?? [];
  return {
    ok: response.ok,
    service: response.service,
    mode: response.mode,
    runtimeMode: response.runtime.mode ?? 'unknown',
    targetCount: targets.length,
    healthyTargets: targets.filter((target) => target.health?.status === 'healthy').length,
    degradedTargets: targets.filter((target) => target.health?.status && target.health.status !== 'healthy').length,
  };
}

export async function fetchVertexCredential(options: AdminApiOptions, id: string): Promise<VertexTargetRow> {
  const response = await adminFetch<AdminVertexCredentialRecord>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options);
  return mapVertexTarget(response);
}
```

Add mutation functions:

```ts
export interface VertexTargetPatchPayload {
  readonly label?: string;
  readonly project?: string;
  readonly location?: string;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelAllowlist?: readonly string[];
  readonly modelExclusions?: readonly string[];
}

export async function updateVertexCredential(options: AdminApiOptions, id: string, patch: VertexTargetPatchPayload): Promise<VertexTargetRow> {
  const response = await adminFetch<{ ok: true; credential: AdminVertexCredentialRecord }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return mapVertexTarget(response.credential);
}

export async function deleteVertexCredential(options: AdminApiOptions, id: string): Promise<void> {
  await adminFetch<{ ok: true; remaining: number }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options, { method: 'DELETE' });
}

export async function testVertexCredential(options: AdminApiOptions, id: string) {
  return adminFetch<{ ok: true; id: string; response: unknown }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}/test`, options, { method: 'POST' });
}
```

Add model catalog functions:

```ts
export async function fetchModelCatalog(options: AdminApiOptions, provider = 'gemini'): Promise<ProviderModelCatalog> {
  return adminFetch<ProviderModelCatalog>(`/admin/api/models?provider=${encodeURIComponent(provider)}`, options);
}

export async function saveModelCatalog(options: AdminApiOptions, provider: string, catalog: ProviderModelCatalog): Promise<ProviderModelCatalog> {
  const response = await adminFetch<{ ok: true; modelCatalog: ProviderModelCatalog }>(`/admin/api/models/${encodeURIComponent(provider)}`, options, {
    method: 'PUT',
    body: JSON.stringify(catalog),
  });
  return response.modelCatalog;
}

export async function reloadRuntime(options: AdminApiOptions): Promise<RuntimeHealthSummary> {
  await adminFetch<{ ok: true; runtime: unknown }>('/admin/api/runtime/reload', options, { method: 'POST' });
  return fetchAdminHealth(options);
}
```

- [ ] **Step 4: Run frontend build**

Run: `cd frontend && npm run build`

Expected: pass with all new types exported and no unused type errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add frontend/src/lib/admin-api.ts frontend/src/lib/admin-dashboard-api.ts
git commit -m "feat: expand admin api client for react console"
```

### Task 4: Build App Shell, Auth Gates, And View Routing

**Files:**
- Create: `frontend/src/hooks/useAdminView.ts`
- Create: `frontend/src/pages/AdminApp.tsx`
- Modify: `frontend/src/components/stitch/StitchConsoleShell.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Add query-param view routing**

Create `frontend/src/hooks/useAdminView.ts`:

```ts
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { adminNavItems } from '@/data/admin-static';
import type { AdminViewId } from '@/types/admin';

const validViews = new Set<AdminViewId>(adminNavItems.map((item) => item.id));

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
};

const getSnapshot = () => window.location.search;

export function useAdminView() {
  const search = useSyncExternalStore(subscribe, getSnapshot, () => '');
  const view = useMemo<AdminViewId>(() => {
    const value = new URLSearchParams(search).get('view');
    return value && validViews.has(value as AdminViewId) ? (value as AdminViewId) : 'dashboard';
  }, [search]);

  const setView = useCallback((nextView: AdminViewId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  return { view, setView };
}
```

- [ ] **Step 2: Replace the shell props and navigation**

Modify `frontend/src/components/stitch/StitchConsoleShell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { adminNavItems } from '@/data/admin-static';
import type { AdminViewId, RuntimeHealthSummary } from '@/types/admin';
import { RuntimeBadges } from '@/components/console/RuntimeBadges';
import { Button } from '@/components/ui/button';

export interface StitchConsoleShellProps {
  readonly activeView: AdminViewId;
  readonly onViewChange: (view: AdminViewId) => void;
  readonly title: string;
  readonly health: RuntimeHealthSummary | null;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly onLogout: () => void;
}
```

Replace the component body:

```tsx
export function StitchConsoleShell({ activeView, onViewChange, title, health, children, actions, onLogout }: StitchConsoleShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-card/95 p-4 lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r">
          <a href="/admin" className="block rounded-lg text-lg font-semibold tracking-tight text-foreground">
            Vertex Gateway Admin
          </a>
          <nav aria-label="Admin navigation" className="mt-8 grid gap-1 text-sm">
            {adminNavItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === activeView ? 'rounded-md bg-secondary px-3 py-2 text-left text-foreground' : 'rounded-md px-3 py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground'}
                onClick={() => onViewChange(item.id)}
              >
                <span className="block font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{item.description}</span>
              </button>
            ))}
          </nav>
        </aside>
        <section className="min-w-0 p-4 xl:p-6">
          <header className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <RuntimeBadges health={health} />
            </div>
            <div className="flex flex-wrap gap-2">
              {actions}
              <Button variant="secondary" onClick={onLogout}>Logout</Button>
            </div>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Add `AdminApp` auth and view switch**

Create `frontend/src/pages/AdminApp.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useAdminView } from '@/hooks/useAdminView';
import { changeAdminPassword, loginAdmin } from '@/lib/admin-dashboard-api';
import { Dashboard } from './Dashboard';
```

Continue imports as views are created in later tasks:

```tsx
import { AIProvidersView } from './AIProvidersView';
import { AuthFilesView } from './AuthFilesView';
import { AvailableModelsView } from './AvailableModelsView';
import { LogsViewerView } from './LogsViewerView';
import { ModelManagementView } from './ModelManagementView';
```

Add the auth component:

```tsx
export function AdminApp() {
  const { token, setToken } = useAdminToken();
  const { view, setView } = useAdminView();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const adminData = useAdminDashboardData(mustChangePassword ? '' : token);
```

Add login and password change handlers:

```tsx
  async function submitLogin() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await loginAdmin(username, password);
      setToken(response.token);
      setMustChangePassword(response.mustChangePassword);
      if (!response.mustChangePassword) setPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Admin login failed');
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitPasswordChange() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await changeAdminPassword({ token }, currentPassword, newPassword);
      setToken(response.token);
      setCurrentPassword('');
      setNewPassword('');
      setPassword('');
      setMustChangePassword(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to change admin password');
    } finally {
      setAuthLoading(false);
    }
  }
```

Add a simple title map and auth gate:

```tsx
  const title = useMemo(() => ({
    dashboard: 'Dashboard',
    'ai-providers': 'AI Providers',
    'auth-files': 'Auth Files',
    'available-models': 'Available Models',
    'logs-viewer': 'Logs Viewer',
    'model-management': 'Model Management',
  }[view]), [view]);

  if (!token || mustChangePassword) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
        <section className="w-full max-w-xl rounded-xl border border-border bg-card p-5">
          <h1 className="text-2xl font-semibold tracking-tight">Vertex Gateway Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Admin token va password chi dung cho operator console.</p>
          <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); void (mustChangePassword ? submitPasswordChange() : submitLogin()); }}>
            {mustChangePassword ? (
              <>
                <Label htmlFor="current-password">Current password</Label>
                <Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </>
            ) : (
              <>
                <Label htmlFor="admin-username">Username</Label>
                <Input id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} />
                <Label htmlFor="admin-password">Password</Label>
                <Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </>
            )}
            {authError ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{authError}</p> : null}
            <Button type="submit" disabled={authLoading}>{authLoading ? 'Dang xu ly...' : mustChangePassword ? 'Change password' : 'Login'}</Button>
          </form>
        </section>
      </main>
    );
  }
```

Add the shell return:

```tsx
  return (
    <StitchConsoleShell
      activeView={view}
      onViewChange={setView}
      title={title}
      health={adminData.health}
      onLogout={() => { setToken(''); setMustChangePassword(false); }}
    >
      {view === 'dashboard' && <Dashboard data={adminData} />}
      {view === 'ai-providers' && <AIProvidersView data={adminData} />}
      {view === 'auth-files' && <AuthFilesView data={adminData} />}
      {view === 'available-models' && <AvailableModelsView data={adminData} />}
      {view === 'logs-viewer' && <LogsViewerView />}
      {view === 'model-management' && <ModelManagementView data={adminData} />}
    </StitchConsoleShell>
  );
}
```

- [ ] **Step 4: Render `AdminApp` from `App.tsx`**

Modify `frontend/src/App.tsx`:

```tsx
import { AdminApp } from './pages/AdminApp';

function App() {
  return <AdminApp />;
}

export default App;
```

- [ ] **Step 5: Create temporary compiling view stubs**

Create each missing view file with a small compiling component. These are replaced by full implementations in Tasks 6 and 7.

Example for `frontend/src/pages/AIProvidersView.tsx`:

```tsx
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface AIProvidersViewProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function AIProvidersView({ data }: AIProvidersViewProps) {
  return <section className="rounded-xl border border-border bg-card p-4">{data.vertexTargets.length} Vertex targets</section>;
}
```

Use the same prop shape for `AuthFilesView.tsx`, `AvailableModelsView.tsx`, and `ModelManagementView.tsx`. `LogsViewerView.tsx` has no props:

```tsx
export function LogsViewerView() {
  return <section className="rounded-xl border border-border bg-card p-4">Logs telemetry beta</section>;
}
```

- [ ] **Step 6: Run frontend build**

Run: `cd frontend && npm run build`

Expected: pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add frontend/src/hooks/useAdminView.ts frontend/src/pages/AdminApp.tsx frontend/src/pages/AIProvidersView.tsx frontend/src/pages/AuthFilesView.tsx frontend/src/pages/AvailableModelsView.tsx frontend/src/pages/LogsViewerView.tsx frontend/src/pages/ModelManagementView.tsx frontend/src/components/stitch/StitchConsoleShell.tsx frontend/src/App.tsx
git commit -m "feat: add react admin shell and view routing"
```

### Task 5: Load Live Admin State And Runtime Actions

**Files:**
- Modify: `frontend/src/hooks/useAdminDashboardData.ts`
- Create: `frontend/src/components/console/AdminState.tsx`
- Create: `frontend/src/components/console/RuntimeBadges.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Add reusable state components**

Create `frontend/src/components/console/AdminState.tsx`:

```tsx
import { Button } from '@/components/ui/button';

export function AdminError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <p>{message}</p>
      {onRetry ? <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm">
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

export function BetaState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="rounded-md border border-[var(--warning-amber)]/40 bg-[var(--warning-amber)]/10 p-4 text-sm">
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}
```

Add skeleton rows:

```tsx
export function TableSkeleton({ rows = 5, columns = 4 }: { readonly rows?: number; readonly columns?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div key={columnIndex} className="h-8 rounded-md bg-secondary/70" />
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add runtime badges**

Create `frontend/src/components/console/RuntimeBadges.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import type { RuntimeHealthSummary } from '@/types/admin';

export function RuntimeBadges({ health }: { readonly health: RuntimeHealthSummary | null }) {
  if (!health) {
    return <div className="mt-2 text-sm text-muted-foreground">Runtime status loading</div>;
  }
  const targetLabel = `${health.healthyTargets}/${health.targetCount} targets ready`;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Badge variant={health.ok ? 'default' : 'destructive'}>{health.ok ? 'Ready' : 'Not ready'}</Badge>
      <Badge variant="secondary">{health.runtimeMode}</Badge>
      <Badge variant="secondary">{health.mode}</Badge>
      <Badge variant={health.degradedTargets > 0 ? 'destructive' : 'secondary'}>{targetLabel}</Badge>
    </div>
  );
}
```

- [ ] **Step 3: Expand `useAdminDashboardData` state**

Modify `frontend/src/hooks/useAdminDashboardData.ts` imports:

```ts
import {
  createGatewayKey,
  createVertexTarget,
  deleteVertexCredential,
  fetchAdminHealth,
  fetchGatewayKeys,
  fetchModelCatalog,
  fetchVertexTargets,
  importServiceAccountTarget,
  reloadRuntime,
  revokeGatewayKey,
  saveModelCatalog,
  testVertexCredential,
  updateVertexCredential,
  type ServiceAccountTargetDraftPayload,
  type VertexTargetDraftPayload,
  type VertexTargetPatchPayload,
} from '@/lib/admin-dashboard-api';
import type { GatewayKeyRow, ProviderModelCatalog, RuntimeHealthSummary, VertexTargetRow } from '@/types/admin';
```

Change state interface:

```ts
interface AdminDashboardState {
  readonly health: RuntimeHealthSummary | null;
  readonly gatewayKeys: readonly GatewayKeyRow[];
  readonly vertexTargets: readonly VertexTargetRow[];
  readonly modelCatalog: ProviderModelCatalog | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly mutable: boolean;
}
```

Initialize state:

```ts
const [state, setState] = useState<AdminDashboardState>({
  health: null,
  gatewayKeys: [],
  vertexTargets: [],
  modelCatalog: null,
  loading: false,
  error: null,
  mutable: false,
});
```

Replace `refresh` load:

```ts
const [health, keysResponse, targets, modelCatalog] = await Promise.all([
  fetchAdminHealth(options),
  fetchGatewayKeys(options),
  fetchVertexTargets(options),
  fetchModelCatalog(options, 'gemini'),
]);
if (refreshSequence.current !== sequence) return;
setState((current) => ({
  ...current,
  health,
  gatewayKeys: keysResponse.gatewayKeys,
  vertexTargets: targets,
  modelCatalog,
  mutable: keysResponse.mutable,
  loading: false,
}));
```

When token is empty, reset all live state:

```ts
setState({ health: null, gatewayKeys: [], vertexTargets: [], modelCatalog: null, loading: false, error: null, mutable: false });
```

- [ ] **Step 4: Add mutation methods to the hook**

Add methods before the return:

```ts
const updateTarget = useCallback(async (id: string, patch: VertexTargetPatchPayload) => {
  await updateVertexCredential(options, id, patch);
  await refresh();
}, [options, refresh]);

const deleteTarget = useCallback(async (id: string) => {
  await deleteVertexCredential(options, id);
  await refresh();
}, [options, refresh]);

const testTarget = useCallback(async (id: string) => testVertexCredential(options, id), [options]);

const saveModels = useCallback(async (provider: string, catalog: ProviderModelCatalog) => {
  const saved = await saveModelCatalog(options, provider, catalog);
  setState((current) => ({ ...current, modelCatalog: saved }));
  return saved;
}, [options]);

const reload = useCallback(async () => {
  const health = await reloadRuntime(options);
  setState((current) => ({ ...current, health }));
  await refresh();
}, [options, refresh]);
```

Return them:

```ts
return {
  ...state,
  refresh,
  createKey,
  revokeKey,
  createTarget,
  importServiceAccount,
  updateTarget,
  deleteTarget,
  testTarget,
  saveModels,
  reload,
};
```

- [ ] **Step 5: Replace `Dashboard.tsx` with live overview**

Replace `frontend/src/pages/Dashboard.tsx` with:

```tsx
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { AdminError, EmptyState, TableSkeleton } from '@/components/console/AdminState';
import { StitchKpiStrip } from '@/components/stitch/StitchKpiStrip';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface DashboardProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function Dashboard({ data }: DashboardProps) {
  const metrics = [
    { id: 'kpi-health', label: 'Runtime', value: data.health?.ok ? 'Ready' : 'Unknown', colorScheme: data.health?.ok ? 'tertiary' as const : 'secondary' as const },
    { id: 'kpi-keys', label: 'Active Gateway Keys', value: String(data.gatewayKeys.filter((key) => key.status === 'active').length), icon: 'key', colorScheme: 'primary' as const },
    { id: 'kpi-targets', label: 'Vertex Targets', value: String(data.vertexTargets.length), icon: 'dns', colorScheme: 'secondary' as const },
    { id: 'kpi-telemetry', label: 'Telemetry', value: 'Beta', colorScheme: 'error' as const },
  ];

  return (
    <div className="grid gap-4">
      <StitchKpiStrip metrics={metrics} />
      {data.error ? <AdminError message={data.error} onRetry={() => void data.refresh()} /> : null}
      {data.loading ? <TableSkeleton rows={4} columns={4} /> : null}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Gateway keys</h2>
            <p className="text-sm text-muted-foreground">Client to Gateway credentials. These are not Google Cloud API keys.</p>
          </div>
          <GatewayKeyDialog onCreate={(label) => data.createKey(label)} disabled={!data.mutable} />
        </div>
        {data.gatewayKeys.length === 0 && !data.loading ? <EmptyState title="No gateway keys" body="No managed gateway keys are available for this admin store." /> : null}
        <GatewayKeysTable rows={data.gatewayKeys} onRevoke={(id) => data.revokeKey(id)} mutable={data.mutable} />
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: pass.

Run: `cd frontend && npm run lint`

Expected: pass with 0 errors.

- [ ] **Step 7: Commit Task 5**

```bash
git add frontend/src/hooks/useAdminDashboardData.ts frontend/src/components/console/AdminState.tsx frontend/src/components/console/RuntimeBadges.tsx frontend/src/pages/Dashboard.tsx
git commit -m "feat: load live admin console state"
```

### Task 6: Build Provider And Credential Views

**Files:**
- Modify: `frontend/src/components/console/VertexTargetsTable.tsx`
- Modify: `frontend/src/pages/AIProvidersView.tsx`
- Modify: `frontend/src/pages/AuthFilesView.tsx`
- Modify: `frontend/src/components/console/VertexTargetDialog.tsx`
- Modify: `frontend/src/components/console/ServiceAccountTargetDialog.tsx`

- [ ] **Step 1: Add row actions to `VertexTargetsTable`**

Modify props:

```ts
export interface VertexTargetsTableProps {
  readonly rows: readonly VertexTargetRow[];
  readonly mutable?: boolean;
  readonly onTest?: (id: string) => Promise<unknown>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly onToggle?: (id: string, enabled: boolean) => Promise<void>;
}
```

Add an Actions column and per-row buttons:

```tsx
<TableHead>Actions</TableHead>
```

Inside each row:

```tsx
<TableCell>
  <div className="flex flex-wrap gap-2">
    <Button size="sm" variant="secondary" onClick={() => void onTest?.(target.id)}>Test</Button>
    {mutable ? (
      <>
        <Button size="sm" variant="secondary" onClick={() => void onToggle?.(target.id, !target.enabled)}>
          {target.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => void onDelete?.(target.id)}>Delete</Button>
      </>
    ) : null}
  </div>
</TableCell>
```

Use `colSpan={7}` for empty rows.

- [ ] **Step 2: Implement AI Providers view**

Replace `frontend/src/pages/AIProvidersView.tsx`:

```tsx
import { AdminError, EmptyState } from '@/components/console/AdminState';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { Button } from '@/components/ui/button';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface AIProvidersViewProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function AIProvidersView({ data }: AIProvidersViewProps) {
  return (
    <div className="grid gap-4">
      {data.error ? <AdminError message={data.error} onRetry={() => void data.refresh()} /> : null}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">AI Providers</h2>
            <p className="text-sm text-muted-foreground">Upstream Vertex targets, health, routing weight, and auth mode.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void data.reload()}>Reload runtime</Button>
            <VertexTargetDialog onCreate={(target) => data.createTarget(target)} disabled={!data.mutable} />
          </div>
        </div>
        {data.vertexTargets.length === 0 ? <EmptyState title="No Vertex targets" body="Create an API-key target or import a service-account target before pool mode can route traffic." /> : null}
        <VertexTargetsTable
          rows={data.vertexTargets}
          mutable={data.mutable}
          onTest={(id) => data.testTarget(id)}
          onToggle={(id, enabled) => data.updateTarget(id, { enabled })}
          onDelete={(id) => data.deleteTarget(id)}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Implement Auth Files view**

Replace `frontend/src/pages/AuthFilesView.tsx`:

```tsx
import { AdminError, EmptyState } from '@/components/console/AdminState';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface AuthFilesViewProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function AuthFilesView({ data }: AuthFilesViewProps) {
  const serviceAccounts = data.vertexTargets.filter((target) => target.authType === 'Service Account JSON');

  return (
    <div className="grid gap-4">
      {data.error ? <AdminError message={data.error} onRetry={() => void data.refresh()} /> : null}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Auth Files</h2>
            <p className="text-sm text-muted-foreground">Service-account JSON is upstream-only. Private key material is never shown after import.</p>
          </div>
          <ServiceAccountTargetDialog onCreate={(target) => data.importServiceAccount(target)} disabled={!data.mutable} />
        </div>
        {serviceAccounts.length === 0 ? <EmptyState title="No service-account files" body="No imported service-account credentials are present in the admin store." /> : null}
        <VertexTargetsTable
          rows={serviceAccounts}
          mutable={data.mutable}
          onTest={(id) => data.testTarget(id)}
          onToggle={(id, enabled) => data.updateTarget(id, { enabled })}
          onDelete={(id) => data.deleteTarget(id)}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Preserve dialog form state on errors**

In `VertexTargetDialog.tsx` and `ServiceAccountTargetDialog.tsx`, ensure submit handlers use this pattern:

```ts
setPending(true);
setError(null);
try {
  await onCreate(draft);
  setOpen(false);
  resetForm();
} catch (error) {
  setError(error instanceof Error ? error.message : 'Admin mutation failed');
} finally {
  setPending(false);
}
```

Do not call `resetForm()` in the `catch` branch. The operator input must remain visible after failed create/import.

- [ ] **Step 5: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: pass.

Run: `cd frontend && npm run lint`

Expected: pass.

- [ ] **Step 6: Commit Task 6**

```bash
git add frontend/src/components/console/VertexTargetsTable.tsx frontend/src/pages/AIProvidersView.tsx frontend/src/pages/AuthFilesView.tsx frontend/src/components/console/VertexTargetDialog.tsx frontend/src/components/console/ServiceAccountTargetDialog.tsx
git commit -m "feat: add provider and auth file admin views"
```

### Task 7: Build Models And Beta Logs Views

**Files:**
- Modify: `frontend/src/pages/AvailableModelsView.tsx`
- Modify: `frontend/src/pages/ModelManagementView.tsx`
- Modify: `frontend/src/pages/LogsViewerView.tsx`
- Create: `frontend/src/components/console/ModelCatalogEditor.tsx`

- [ ] **Step 1: Add model catalog editor component**

Create `frontend/src/components/console/ModelCatalogEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProviderModelCatalog } from '@/types/admin';

interface ModelCatalogEditorProps {
  readonly catalog: ProviderModelCatalog | null;
  readonly mutable: boolean;
  readonly onSave: (catalog: ProviderModelCatalog) => Promise<void>;
}

const linesToArray = (value: string): string[] => value.split('\n').map((line) => line.trim()).filter(Boolean);
const arrayToLines = (value: readonly string[]): string => value.join('\n');
```

Continue the component:

```tsx
export function ModelCatalogEditor({ catalog, mutable, onSave }: ModelCatalogEditorProps) {
  const [defaultModel, setDefaultModel] = useState('');
  const [aliases, setAliases] = useState('');
  const [allowlist, setAllowlist] = useState('');
  const [disabled, setDisabled] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDefaultModel(catalog?.defaultModel ?? '');
    setAliases(Object.entries(catalog?.aliases ?? {}).map(([alias, model]) => `${alias}=${model}`).join('\n'));
    setAllowlist(arrayToLines(catalog?.allowlist ?? []));
    setDisabled(arrayToLines(catalog?.disabled ?? []));
  }, [catalog]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await onSave({
        defaultModel: defaultModel.trim() || undefined,
        aliases: Object.fromEntries(linesToArray(aliases).map((line) => {
          const [alias, ...modelParts] = line.split('=');
          return [alias.trim(), modelParts.join('=').trim()];
        }).filter(([alias, model]) => alias && model)),
        allowlist: linesToArray(allowlist),
        disabled: linesToArray(disabled),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save model catalog');
    } finally {
      setPending(false);
    }
  }
```

Finish render:

```tsx
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Gemini model policy</h2>
        <p className="text-sm text-muted-foreground">Default model, aliases, allowlist, and disabled entries for gateway routing.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="grid gap-2"><Label htmlFor="model-default">Default model</Label><Input id="model-default" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="model-aliases">Aliases, one alias=model per line</Label><Textarea id="model-aliases" value={aliases} onChange={(event) => setAliases(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="model-allowlist">Allowlist, one model per line</Label><Textarea id="model-allowlist" value={allowlist} onChange={(event) => setAllowlist(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="model-disabled">Disabled, one model per line</Label><Textarea id="model-disabled" value={disabled} onChange={(event) => setDisabled(event.target.value)} /></div>
      </div>
      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      <Button className="w-fit" disabled={!mutable || pending} onClick={() => void submit()}>{pending ? 'Saving...' : 'Save model policy'}</Button>
    </section>
  );
}
```

- [ ] **Step 2: Implement Available Models view**

Replace `frontend/src/pages/AvailableModelsView.tsx`:

```tsx
import { EmptyState } from '@/components/console/AdminState';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface AvailableModelsViewProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function AvailableModelsView({ data }: AvailableModelsViewProps) {
  const catalog = data.modelCatalog;
  const visibleModels = catalog ? Array.from(new Set([
    catalog.defaultModel,
    ...Object.values(catalog.aliases),
    ...catalog.allowlist,
  ].filter((value): value is string => Boolean(value)))) : [];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xl font-semibold tracking-tight">Available Models</h2>
      <p className="mt-1 text-sm text-muted-foreground">Read-only catalog view. Use Model Management for policy edits.</p>
      {visibleModels.length === 0 ? <EmptyState title="No model catalog entries" body="The gateway has no configured Gemini catalog entries in the admin store." /> : null}
      <div className="mt-4 grid gap-2">
        {visibleModels.map((model) => (
          <div key={model} className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
            <span className="font-mono text-sm">{model}</span>
            <span className="text-xs text-muted-foreground">{catalog?.disabled.includes(model) ? 'disabled' : 'visible'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Implement Model Management view**

Replace `frontend/src/pages/ModelManagementView.tsx`:

```tsx
import { AdminError } from '@/components/console/AdminState';
import { ModelCatalogEditor } from '@/components/console/ModelCatalogEditor';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import type { ProviderModelCatalog } from '@/types/admin';

interface ModelManagementViewProps {
  readonly data: ReturnType<typeof useAdminDashboardData>;
}

export function ModelManagementView({ data }: ModelManagementViewProps) {
  async function save(catalog: ProviderModelCatalog) {
    await data.saveModels('gemini', catalog);
    await data.reload();
  }

  return (
    <div className="grid gap-4">
      {data.error ? <AdminError message={data.error} onRetry={() => void data.refresh()} /> : null}
      <ModelCatalogEditor catalog={data.modelCatalog} mutable={data.mutable} onSave={save} />
    </div>
  );
}
```

- [ ] **Step 4: Implement honest beta Logs Viewer**

Replace `frontend/src/pages/LogsViewerView.tsx`:

```tsx
import { BetaState } from '@/components/console/AdminState';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function LogsViewerView() {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Logs Viewer</h2>
        <p className="text-sm text-muted-foreground">Telemetry UI is present for feature parity. The gateway does not expose a live logs API yet.</p>
      </div>
      <BetaState title="Telemetry backend is not live" body="Filters and table structure are shown so the operator workflow is clear, but no fake operational rows are rendered." />
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="grid gap-2"><Label htmlFor="logs-search">Search</Label><Input id="logs-search" disabled placeholder="No live log source" /></div>
        <Select disabled value="all"><SelectTrigger aria-label="Route family"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">all</SelectItem></SelectContent></Select>
        <Select disabled value="all"><SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">all</SelectItem></SelectContent></Select>
      </div>
      <Table className="mt-4">
        <TableHeader><TableRow><TableHead>time</TableHead><TableHead>route</TableHead><TableHead>model</TableHead><TableHead>status</TableHead><TableHead>latency</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No live telemetry API is connected.</TableCell></TableRow></TableBody>
      </Table>
    </section>
  );
}
```

- [ ] **Step 5: Run frontend checks**

Run: `cd frontend && npm run build`

Expected: pass.

Run: `cd frontend && npm run lint`

Expected: pass.

- [ ] **Step 6: Commit Task 7**

```bash
git add frontend/src/components/console/ModelCatalogEditor.tsx frontend/src/pages/AvailableModelsView.tsx frontend/src/pages/ModelManagementView.tsx frontend/src/pages/LogsViewerView.tsx
git commit -m "feat: add model management and beta logs views"
```

### Task 8: Route Replacement Cleanup And Full Validation

**Files:**
- Modify: `frontend/src/data/mockData.ts` or delete it if unused
- Modify: `src/admin/admin-ui.ts` only if tests or imports prove it can be safely marked legacy
- Verify: backend and frontend build/test commands

- [ ] **Step 1: Find unused mock/static UI references**

Run: `rg "mockData|apiLogs|kpiMetrics|renderAdminUi|Vertex JSON Login|id=\"log-search\"" frontend src test`

Expected:
- `mockData`, `apiLogs`, and `kpiMetrics` have no frontend imports.
- `renderAdminUi` appears only in `src/admin/admin-ui.ts` and `test/admin-ui.test.ts`.
- Old static UI markers do not appear in `src/admin/admin-routes.ts`.

- [ ] **Step 2: Delete unused mock data file if it has no imports**

If Step 1 shows no imports of `frontend/src/data/mockData.ts`, delete it:

```bash
git rm frontend/src/data/mockData.ts
```

If a type import remains, move that type to `frontend/src/types/admin.ts`, update the import, then delete the file.

- [ ] **Step 3: Add a legacy note to `admin-ui.ts`**

If `renderAdminUi()` remains in the repository, add this comment above its export:

```ts
// Legacy rollback renderer. The live /admin route serves the React SPA from frontend/dist.
```

Do not remove `src/admin/admin-ui.ts` in this slice unless the user explicitly approves deleting the rollback implementation.

- [ ] **Step 4: Run full backend validation**

Run: `npm run compile`

Expected: TypeScript compile succeeds.

Run: `npm test`

Expected: full Vitest suite passes.

- [ ] **Step 5: Run full frontend validation**

Run: `cd frontend && npm run lint`

Expected: oxlint exits with 0 errors.

Run: `cd frontend && npm run build`

Expected: TypeScript project build and Vite production build succeed.

- [ ] **Step 6: Run local `/admin` browser smoke**

Start the gateway:

```bash
npm run dev
```

Open `http://localhost:19089/admin` and confirm:

1. The page shows the dark React operator console, not the beige backend-rendered UI.
2. Login with `admin / changeme` reaches the forced password-change screen on first-use file-store setups.
3. After password change, all six sidebar views are reachable.
4. `?view=model-management` opens the Model Management view directly.
5. Gateway key create and revoke update the table without exposing full secrets after the create response.
6. API-key target create, service-account import, inspect/test/toggle/delete actions use `/admin/api/*` and show scoped errors.
7. Available Models loads the Gemini model catalog.
8. Model Management saves catalog policy and reloads runtime.
9. Logs Viewer is clearly marked beta and renders no fake live rows.
10. Browser console has no React runtime errors.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/admin/admin-ui.ts frontend/src/types/admin.ts frontend/src/data/admin-static.ts frontend/src/data/mockData.ts
git commit -m "chore: retire mock admin data from live console"
```

If `frontend/src/data/mockData.ts` was deleted, use:

```bash
git add src/admin/admin-ui.ts frontend/src/types/admin.ts frontend/src/data/admin-static.ts
git add -u frontend/src/data/mockData.ts
git commit -m "chore: retire mock admin data from live console"
```

Skip this commit only if Step 1 proves there are no cleanup edits after Task 7.

## Self-Review Checklist

- Spec coverage: `/admin` route replacement, `/admin/api/*` stability, six navigation views, live admin-backed data, runtime reload, model catalog load/save, credential create/import/inspect/test/edit/delete, and beta Logs Viewer are each covered by a task.
- Boundary check: no public Gemini/OpenAI gateway route behavior changes are included. Backend changes are limited to admin SPA serving and existing admin API consumption.
- Auth distinction: Gateway keys remain Client to Gateway credentials; Vertex API keys and service-account JSON remain Gateway to Google upstream credentials and are never shown as client secrets.
- Design alignment: shell, badges, tables, forms, and beta states use the dark Stitch console direction from `frontend/DESIGN.md`; the old beige UI is no longer the live route.
- Placeholder scan: the plan avoids fake telemetry rows and does not instruct implementers to add unspecified error handling or unspecified tests.
- Validation: backend compile, full backend tests, frontend lint/build, and local browser smoke are required before completion.
