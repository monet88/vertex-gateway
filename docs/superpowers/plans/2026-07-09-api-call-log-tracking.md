# API Call Log Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship gated API-call log tracking (dual-write memory + JSONL, admin diagnostics settings, live Nhật ký API UI with Refresh / Auto Refresh / Clear) per `workflows/api-call-log-tracking.md`.

**Architecture:** A process-scoped `ApiCallLogStore` dual-writes redacted metadata events to a 500-entry memory ring and `{adminFileStoreDir}/logs/api-calls.log` (10MB rotate + one backup). Diagnostics flags `debugMode` + `logToFile` persist in admin file-store settings; gate is hard AND. Public gateway requests in `createApp` record after completion when gate is ON. Admin routes expose diagnostics GET/PATCH and logs GET/DELETE. React admin shows settings under Cấu hình, hides Nhật ký API unless gate ON, and replaces mock dashboard logs with live preview or CTA.

**Tech Stack:** Node 22+, TypeScript, vitest, existing `node:http` admin routes, React 19 + Vite admin SPA, `admin-settings.json` file-store.

**Spec source:** `workflows/api-call-log-tracking.md`, `NOTES.md`

## Global Constraints

- Gate: `gateEnabled = debugMode && logToFile` only; both default OFF
- Capture + live logs UI only when gate ON
- Dual-write: memory ring max 500 + JSONL file; UI reads memory
- Schema metadata-only; never bodies, raw auth headers, full keys/tokens, SA private keys, admin tokens
- Path query secrets redacted (`api_key|key|token|authorization` → `?[redacted]`)
- Capture scope: classified public `gemini`/`openai` gateway API only; never `/admin/*`, `/healthz`, `/readyz`, static admin assets
- Writable diagnostics requires `adminStoreMode === "file-store"` AND `adminAllowMutations` AND `adminFileStoreDir`
- static-config / mutations-off: toggles disabled, no capture, no live logs surface
- Restart: reload flags from disk; memory empty; do not hydrate from file
- Gate OFF: stop capture, do not auto-wipe memory/file; GET logs returns 409
- Clear: memory + active file + backup; confirm in UI only
- Auto Refresh: client poll 5s, default OFF; no SSE
- File write failures must not fail client API responses
- Vietnamese operational copy from workflow UI copy defaults
- Follow root `DESIGN.md` for admin UI (dark console, operator teal, no mock live rows)
- Tests: vitest via `npm test -- <file>`; no new deps unless required
- Commits: conventional (`feat:`, `fix:`, `test:`, `chore:`)

## File map

| File | Responsibility |
|------|----------------|
| Create `src/admin/api-call-log-store.ts` | Redaction helpers, ring + JSONL dual-write, list/filter/clear/rotate |
| Create `src/admin/diagnostics-settings.ts` | Load/persist `debugMode`/`logToFile`, gate + writable helpers |
| Create `test/api-call-log-store.test.ts` | Unit tests for store |
| Create `test/diagnostics-settings.test.ts` | Unit tests for diagnostics persistence/gate |
| Modify `src/config/admin-settings-store.ts` | Extend `AdminFileStoreSettings` with optional diagnostics flags |
| Modify `src/admin/admin-routes.ts` | Diagnostics + logs endpoints; accept shared store/state |
| Modify `src/app.ts` | Own store/state; capture hook on public gateway requests; pass deps into admin |
| Modify `test/admin-routes.test.ts` or create `test/admin-diagnostics-logs.test.ts` | Route-level diagnostics/logs tests |
| Modify `frontend/src/types/admin.ts` | Diagnostics + log row types |
| Modify `frontend/src/lib/admin-dashboard-api.ts` | Client calls for diagnostics/logs |
| Create `frontend/src/hooks/useDiagnostics.ts` | Fetch/patch diagnostics; expose gate |
| Create `frontend/src/hooks/useApiLogs.ts` | Fetch logs, refresh, auto-refresh, clear |
| Modify `frontend/src/lib/table.ts` + `useLogTable.ts` + `ApiLogsTable.tsx` | Filters method/search; live row shape |
| Modify `frontend/src/pages/AIProvidersView.tsx` | Logging & Diagnostics toggles |
| Modify `frontend/src/pages/LogsViewerView.tsx` | Live toolbar + raw mode |
| Modify `frontend/src/pages/AdminApp.tsx` + `StitchConsoleShell.tsx` + `admin-static.ts` + `useAdminView.ts` | Gate nav visibility + deep-link fallback |
| Modify `frontend/src/pages/Dashboard.tsx` | Remove mock logs; live preview or CTA |
| Modify `frontend/src/data/mockData.ts` | Keep types if still needed or relocate types to `types/admin.ts` and stop exporting mock rows for dashboard/logs |
| Optional `test/admin-frontend-helpers.test.ts` | Pure helper tests if extracted |

---

### Task 1: ApiCallLogStore (memory + JSONL dual-write)

**Files:**
- Create: `src/admin/api-call-log-store.ts`
- Test: `test/api-call-log-store.test.ts`

**Interfaces:**
- Produces:
  - `export type ApiCallStatusClass = '2xx' | '4xx' | '5xx'`
  - `export interface ApiCallLogEntry { id: string; timestamp: string; requestId: string; method: string; path: string; statusCode: number; statusClass: ApiCallStatusClass; latencyMs: number; routeFamily: string; operation: string; model?: string; gatewayKeyPreview?: string | null; upstreamTarget?: string | null; errorCode?: string | null }`
  - `export type ApiCallLogInput = Omit<ApiCallLogEntry, 'id' | 'timestamp' | 'statusClass' | 'path'> & { path: string; statusCode: number }`
  - `export interface ApiCallLogListFilter { limit?: number; statusClass?: ApiCallStatusClass; routeFamily?: string; method?: string; search?: string }`
  - `export interface ApiCallLogStore { record(input: ApiCallLogInput): ApiCallLogEntry | null; list(filter?: ApiCallLogListFilter): ApiCallLogEntry[]; clear(): void; size(): number; readonly maxEntries: number; readonly logFilePath: string | null }`
  - `export function createApiCallLogStore(options: { maxEntries?: number; logFilePath: string | null; maxFileBytes?: number }): ApiCallLogStore`
  - `export function redactLogPath(path: string): string`
  - `export function statusClassForCode(statusCode: number): ApiCallStatusClass`
  - `export function maskGatewayKeyPreview(secret: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing unit test**

```ts
// test/api-call-log-store.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createApiCallLogStore,
  maskGatewayKeyPreview,
  redactLogPath,
  statusClassForCode,
} from '../src/admin/api-call-log-store.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tempLogPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgl-'));
  tempDirs.push(dir);
  return path.join(dir, 'logs', 'api-calls.log');
};

describe('api-call-log-store helpers', () => {
  it('redacts sensitive query params', () => {
    expect(redactLogPath('/openai/v1/models?api_key=secret&x=1')).toBe('/openai/v1/models?[redacted]');
    expect(redactLogPath('/openai/v1/models')).toBe('/openai/v1/models');
  });

  it('maps status classes and masks gateway keys', () => {
    expect(statusClassForCode(204)).toBe('2xx');
    expect(statusClassForCode(404)).toBe('4xx');
    expect(statusClassForCode(503)).toBe('5xx');
    expect(maskGatewayKeyPreview('vgw_abcdefghijklmnop1234')).toMatch(/^vgw_abcd\.\.\./);
    expect(maskGatewayKeyPreview(null)).toBeNull();
  });
});

describe('createApiCallLogStore', () => {
  it('dual-writes to memory and JSONL and lists newest first', () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 3, logFilePath });
    store.record({
      requestId: 'r1', method: 'GET', path: '/openai/v1/models?key=abc', statusCode: 200,
      latencyMs: 12, routeFamily: 'openai', operation: 'models', model: 'gemini-3.5-flash',
      gatewayKeyPreview: 'vgw_...1', upstreamTarget: 't1',
    });
    store.record({
      requestId: 'r2', method: 'POST', path: '/openai/v1/chat/completions', statusCode: 500,
      latencyMs: 99, routeFamily: 'openai', operation: 'chatCompletions', errorCode: 'UPSTREAM',
    });
    const rows = store.list({ limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.requestId).toBe('r2');
    expect(rows[1]?.path).toBe('/openai/v1/models?[redacted]');
    expect(rows[0]?.statusClass).toBe('5xx');
    const lines = fs.readFileSync(logFilePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).requestId).toBe('r2');
  });

  it('filters by statusClass, method, routeFamily, and search', () => {
    const store = createApiCallLogStore({ maxEntries: 10, logFilePath: tempLogPath() });
    store.record({ requestId: 'a', method: 'GET', path: '/openai/v1/models', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models', model: 'flash' });
    store.record({ requestId: 'b', method: 'POST', path: '/gemini/v1beta/models/x:generateContent', statusCode: 404, latencyMs: 2, routeFamily: 'gemini', operation: 'generateContent' });
    expect(store.list({ statusClass: '4xx' })).toHaveLength(1);
    expect(store.list({ method: 'GET' })[0]?.requestId).toBe('a');
    expect(store.list({ routeFamily: 'gemini' })[0]?.requestId).toBe('b');
    expect(store.list({ search: 'flash' })[0]?.requestId).toBe('a');
  });

  it('evicts oldest beyond maxEntries and clear removes memory + files', () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 2, logFilePath, maxFileBytes: 1024 * 1024 });
    store.record({ requestId: '1', method: 'GET', path: '/a', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    store.record({ requestId: '2', method: 'GET', path: '/b', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    store.record({ requestId: '3', method: 'GET', path: '/c', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    expect(store.list().map((e) => e.requestId)).toEqual(['3', '2']);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(logFilePath)).toBe(false);
    expect(fs.existsSync(`${logFilePath}.1`)).toBe(false);
  });

  it('rotates active file when maxFileBytes exceeded', () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 50, logFilePath, maxFileBytes: 200 });
    for (let i = 0; i < 20; i += 1) {
      store.record({
        requestId: `id-${i}-${'x'.repeat(32)}`,
        method: 'POST',
        path: `/openai/v1/chat/completions/${i}`,
        statusCode: 200,
        latencyMs: i,
        routeFamily: 'openai',
        operation: 'chatCompletions',
      });
    }
    expect(fs.existsSync(`${logFilePath}.1`)).toBe(true);
    expect(fs.existsSync(logFilePath)).toBe(true);
  });

  it('ignores file errors when logFilePath parent cannot be written but still keeps memory', () => {
    const store = createApiCallLogStore({
      maxEntries: 5,
      logFilePath: path.join(path.sep, 'definitely-not-writable-vgl', 'api-calls.log'),
    });
    const entry = store.record({
      requestId: 'mem-only', method: 'GET', path: '/openai/v1/models', statusCode: 200,
      latencyMs: 1, routeFamily: 'openai', operation: 'models',
    });
    expect(entry?.requestId).toBe('mem-only');
    expect(store.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/api-call-log-store.test.ts`

Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Implement store**

```ts
// src/admin/api-call-log-store.ts
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ApiCallStatusClass = '2xx' | '4xx' | '5xx';

export interface ApiCallLogEntry {
  id: string;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  statusClass: ApiCallStatusClass;
  latencyMs: number;
  routeFamily: string;
  operation: string;
  model?: string;
  gatewayKeyPreview?: string | null;
  upstreamTarget?: string | null;
  errorCode?: string | null;
}

export type ApiCallLogInput = Omit<ApiCallLogEntry, 'id' | 'timestamp' | 'statusClass' | 'path'> & {
  path: string;
  statusCode: number;
};

export interface ApiCallLogListFilter {
  limit?: number;
  statusClass?: ApiCallStatusClass;
  routeFamily?: string;
  method?: string;
  search?: string;
}

export interface ApiCallLogStore {
  record(input: ApiCallLogInput): ApiCallLogEntry | null;
  list(filter?: ApiCallLogListFilter): ApiCallLogEntry[];
  clear(): void;
  size(): number;
  readonly maxEntries: number;
  readonly logFilePath: string | null;
}

const SENSITIVE_QUERY = /[?&](api_key|key|token|authorization)=/i;

export const redactLogPath = (rawPath: string): string => {
  if (!SENSITIVE_QUERY.test(rawPath)) return rawPath;
  const q = rawPath.indexOf('?');
  return q === -1 ? rawPath : `${rawPath.slice(0, q)}?[redacted]`;
};

export const statusClassForCode = (statusCode: number): ApiCallStatusClass => {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  return '5xx';
};

export const maskGatewayKeyPreview = (secret: string | null | undefined): string | null => {
  if (!secret) return null;
  if (secret.length >= 16) return `${secret.slice(0, 8)}...${secret.slice(-4)}`;
  if (secret.length <= 4) return `${'*'.repeat(Math.max(secret.length, 1))}...`;
  return `${secret.slice(0, 4)}...`;
};

const matchesFilter = (entry: ApiCallLogEntry, filter: ApiCallLogListFilter): boolean => {
  if (filter.statusClass && entry.statusClass !== filter.statusClass) return false;
  if (filter.routeFamily && entry.routeFamily !== filter.routeFamily) return false;
  if (filter.method && entry.method.toUpperCase() !== filter.method.toUpperCase()) return false;
  const search = filter.search?.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    entry.path,
    entry.requestId,
    entry.model ?? '',
    entry.gatewayKeyPreview ?? '',
    entry.upstreamTarget ?? '',
    entry.operation,
  ].join(' ').toLowerCase();
  return haystack.includes(search);
};

const appendJsonl = (filePath: string, entry: ApiCallLogEntry, maxFileBytes: number): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    size = 0;
  }
  if (size >= maxFileBytes) {
    const backup = `${filePath}.1`;
    try { fs.rmSync(backup, { force: true }); } catch { /* ignore */ }
    try { fs.renameSync(filePath, backup); } catch { /* ignore */ }
  }
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
};

export const createApiCallLogStore = (options: {
  maxEntries?: number;
  logFilePath: string | null;
  maxFileBytes?: number;
}): ApiCallLogStore => {
  const maxEntries = options.maxEntries ?? 500;
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  const logFilePath = options.logFilePath;
  const entries: ApiCallLogEntry[] = [];

  return {
    maxEntries,
    logFilePath,
    size: () => entries.length,
    record(input) {
      const entry: ApiCallLogEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: input.requestId,
        method: input.method.toUpperCase(),
        path: redactLogPath(input.path),
        statusCode: input.statusCode,
        statusClass: statusClassForCode(input.statusCode),
        latencyMs: input.latencyMs,
        routeFamily: input.routeFamily,
        operation: input.operation,
        model: input.model,
        gatewayKeyPreview: input.gatewayKeyPreview ?? null,
        upstreamTarget: input.upstreamTarget ?? null,
        errorCode: input.errorCode ?? null,
      };
      entries.unshift(entry);
      if (entries.length > maxEntries) entries.length = maxEntries;
      if (logFilePath) {
        try {
          appendJsonl(logFilePath, entry, maxFileBytes);
        } catch {
          // best-effort file write; memory already updated
        }
      }
      return entry;
    },
    list(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), maxEntries);
      return entries.filter((entry) => matchesFilter(entry, filter)).slice(0, limit).map((e) => ({ ...e }));
    },
    clear() {
      entries.length = 0;
      if (!logFilePath) return;
      try { fs.rmSync(logFilePath, { force: true }); } catch { /* ignore */ }
      try { fs.rmSync(`${logFilePath}.1`, { force: true }); } catch { /* ignore */ }
    },
  };
};
```

- [ ] **Step 4: Run tests and make sure they pass**

Run: `npm test -- test/api-call-log-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/api-call-log-store.ts test/api-call-log-store.test.ts
git commit -m "feat(admin): add dual-write api call log store"
```

---

### Task 2: Diagnostics settings persistence + gate helpers

**Files:**
- Modify: `src/config/admin-settings-store.ts`
- Create: `src/admin/diagnostics-settings.ts`
- Test: `test/diagnostics-settings.test.ts`

**Interfaces:**
- Consumes: `readAdminFileStoreSettings`, `persistAdminFileStoreSettings`, `GatewayConfig`
- Produces:
  - `export interface DiagnosticsFlags { debugMode: boolean; logToFile: boolean }`
  - `export interface DiagnosticsSnapshot extends DiagnosticsFlags { gateEnabled: boolean; writable: boolean; logFilePath: string | null; ringSize: number; entryCount: number }`
  - `export function isDiagnosticsWritable(config: GatewayConfig): boolean`
  - `export function resolveApiCallLogFilePath(config: GatewayConfig): string | null`
  - `export function readDiagnosticsFlags(config: GatewayConfig): DiagnosticsFlags`
  - `export function writeDiagnosticsFlags(config: GatewayConfig, patch: Partial<DiagnosticsFlags>): DiagnosticsFlags`
  - `export function isDiagnosticsGateEnabled(flags: DiagnosticsFlags): boolean`

- [ ] **Step 1: Write failing tests**

```ts
// test/diagnostics-settings.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isDiagnosticsGateEnabled,
  isDiagnosticsWritable,
  readDiagnosticsFlags,
  resolveApiCallLogFilePath,
  writeDiagnosticsFlags,
} from '../src/admin/diagnostics-settings.js';
import { testConfig } from './test-config.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('diagnostics-settings', () => {
  it('defaults both flags off and gate disabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    expect(readDiagnosticsFlags(config)).toEqual({ debugMode: false, logToFile: false });
    expect(isDiagnosticsGateEnabled(readDiagnosticsFlags(config))).toBe(false);
    expect(isDiagnosticsWritable(config)).toBe(true);
    expect(resolveApiCallLogFilePath(config)).toBe(path.join(dir, 'logs', 'api-calls.log'));
  });

  it('persists flags in admin-settings.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    const next = writeDiagnosticsFlags(config, { debugMode: true, logToFile: true });
    expect(next).toEqual({ debugMode: true, logToFile: true });
    expect(isDiagnosticsGateEnabled(next)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'admin-settings.json'), 'utf8'));
    expect(raw.debugMode).toBe(true);
    expect(raw.logToFile).toBe(true);
    expect(readDiagnosticsFlags(config)).toEqual({ debugMode: true, logToFile: true });
  });

  it('is not writable in static-config', () => {
    const config = testConfig({ adminStoreMode: 'static-config', adminAllowMutations: false, adminFileStoreDir: null });
    expect(isDiagnosticsWritable(config)).toBe(false);
    expect(resolveApiCallLogFilePath(config)).toBeNull();
    expect(() => writeDiagnosticsFlags(config, { debugMode: true })).toThrow(/not writable/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- test/diagnostics-settings.test.ts`

- [ ] **Step 3: Extend settings type + implement diagnostics module**

In `src/config/admin-settings-store.ts`, add to `AdminFileStoreSettings`:

```ts
  debugMode?: boolean | null;
  logToFile?: boolean | null;
```

Create `src/admin/diagnostics-settings.ts`:

```ts
import path from 'node:path';
import type { GatewayConfig } from '../config/env.js';
import {
  persistAdminFileStoreSettings,
  readAdminFileStoreSettings,
} from '../config/admin-settings-store.js';
import { GatewayError } from '../http/error-response.js';

export interface DiagnosticsFlags {
  debugMode: boolean;
  logToFile: boolean;
}

export const isDiagnosticsWritable = (config: GatewayConfig): boolean =>
  config.adminStoreMode === 'file-store'
  && config.adminAllowMutations
  && Boolean(config.adminFileStoreDir);

export const resolveApiCallLogFilePath = (config: GatewayConfig): string | null => {
  if (!config.adminFileStoreDir) return null;
  return path.join(config.adminFileStoreDir, 'logs', 'api-calls.log');
};

export const isDiagnosticsGateEnabled = (flags: DiagnosticsFlags): boolean =>
  flags.debugMode && flags.logToFile;

export const readDiagnosticsFlags = (config: GatewayConfig): DiagnosticsFlags => {
  const settings = readAdminFileStoreSettings(config);
  return {
    debugMode: settings.debugMode === true,
    logToFile: settings.logToFile === true,
  };
};

export const writeDiagnosticsFlags = (
  config: GatewayConfig,
  patch: Partial<DiagnosticsFlags>,
): DiagnosticsFlags => {
  if (!isDiagnosticsWritable(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Diagnostics settings are not writable.');
  }
  const current = readDiagnosticsFlags(config);
  const next: DiagnosticsFlags = {
    debugMode: typeof patch.debugMode === 'boolean' ? patch.debugMode : current.debugMode,
    logToFile: typeof patch.logToFile === 'boolean' ? patch.logToFile : current.logToFile,
  };
  persistAdminFileStoreSettings(config, {
    debugMode: next.debugMode,
    logToFile: next.logToFile,
  });
  return next;
};
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- test/diagnostics-settings.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/config/admin-settings-store.ts src/admin/diagnostics-settings.ts test/diagnostics-settings.test.ts
git commit -m "feat(admin): persist diagnostics debugMode and logToFile flags"
```

---

### Task 3: Admin API routes for diagnostics + logs

**Files:**
- Modify: `src/admin/admin-routes.ts`
- Create: `test/admin-diagnostics-logs.test.ts`

**Interfaces:**
- Consumes: `createApiCallLogStore`, diagnostics helpers, `requireAdminAuth`
- Produces endpoints:
  - `GET /admin/api/diagnostics`
  - `PATCH /admin/api/diagnostics`
  - `GET /admin/api/logs`
  - `DELETE /admin/api/logs`
- Change `maybeHandleAdminRoute` signature to accept optional deps:

```ts
export interface AdminRouteDeps {
  apiCallLogStore: ApiCallLogStore;
}

export const maybeHandleAdminRoute = (
  req, res, url, config, runtime?, onConfigReload?, deps?: AdminRouteDeps,
): Promise<boolean>
```

If `deps` omitted in tests that do not care, construct a default in-memory store with `logFilePath` from config when writable.

- [ ] **Step 1: Write route tests (failing)**

```ts
// test/admin-diagnostics-logs.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { hashAdminPassword } from '../src/admin/admin-password.js';
import type { GenAiRuntimeLike } from '../src/lib/genai-runtime.js';
import { testConfig } from './test-config.js';

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const seedAdmin = async (storeDir: string) => {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'admin-settings.json'), JSON.stringify({
    adminUsername: 'admin',
    adminPasswordHash: await hashAdminPassword('changed-admin-password'),
    adminPasswordChangedAt: new Date(0).toISOString(),
  }));
};

const login = async (baseUrl: string) => {
  const res = await fetch(`${baseUrl}/admin/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'changed-admin-password' }),
  });
  const body = await res.json() as { token: string };
  return body.token;
};

const fakeRuntime = (): GenAiRuntimeLike => ({
  client: { models: { generateContent: vi.fn(async () => ({})) } },
  getSnapshot: () => ({
    mode: 'pool',
    active: {
      version: 1,
      selection: 'round-robin',
      targetCount: 0,
      healthyTargets: 0,
      cooldownTargets: 0,
      targets: [],
    },
  }),
  reload: vi.fn(),
});

describe('admin diagnostics and logs routes', () => {
  const servers: Server[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GET diagnostics, PATCH gate on, list/clear logs', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-admin-diag-'));
    dirs.push(storeDir);
    await seedAdmin(storeDir);
    const server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminStoreMode: 'file-store',
        adminAllowMutations: true,
        adminFileStoreDir: storeDir,
        adminToken: null,
        gatewayKeys: ['test-key'],
      }),
      runtimeFactory: () => fakeRuntime(),
    });
    servers.push(server);
    const baseUrl = await listen(server);
    const token = await login(baseUrl);

    const diag1 = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(diag1.status).toBe(200);
    const d1 = await diag1.json() as { debugMode: boolean; logToFile: boolean; gateEnabled: boolean; writable: boolean };
    expect(d1).toMatchObject({ debugMode: false, logToFile: false, gateEnabled: false, writable: true });

    const logsOff = await fetch(`${baseUrl}/admin/api/logs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logsOff.status).toBe(409);

    const patch = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ debugMode: true, logToFile: true }),
    });
    expect(patch.status).toBe(200);
    const d2 = await patch.json() as { gateEnabled: boolean };
    expect(d2.gateEnabled).toBe(true);

    // capture via public route
    await fetch(`${baseUrl}/openai/v1/models`, {
      headers: { authorization: 'Bearer test-key' },
    });

    const logsOn = await fetch(`${baseUrl}/admin/api/logs?limit=10`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logsOn.status).toBe(200);
    const listed = await logsOn.json() as { entries: Array<{ routeFamily: string; path: string }> };
    expect(listed.entries.length).toBeGreaterThan(0);
    expect(listed.entries[0]?.routeFamily).toBe('openai');

    const cleared = await fetch(`${baseUrl}/admin/api/logs`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cleared.status).toBe(200);
    const logsEmpty = await fetch(`${baseUrl}/admin/api/logs`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const emptyBody = await logsEmpty.json() as { entries: unknown[] };
    expect(emptyBody.entries).toEqual([]);
  });

  it('rejects diagnostics patch when static-config', async () => {
    const server = createApp({
      config: testConfig({
        enableAdminRoutes: true,
        adminStoreMode: 'static-config',
        adminAllowMutations: false,
        adminFileStoreDir: null,
        adminToken: 'static-admin-token-value',
      }),
      runtimeFactory: () => fakeRuntime(),
    });
    servers.push(server);
    const baseUrl = await listen(server);
    const res = await fetch(`${baseUrl}/admin/api/diagnostics`, {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer static-admin-token-value',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ debugMode: true, logToFile: true }),
    });
    expect(res.status).toBe(409);
  });
});
```

Note: public `/openai/v1/models` may need runtime/model wiring already present in other tests — if list models fails upstream, capture must still record the finished response status from `res.statusCode` in the app finally/capture path. Prefer recording even when handler throws after status is set; see Task 4.

- [ ] **Step 2: Run test — expect FAIL** (routes missing / capture missing)

Run: `npm test -- test/admin-diagnostics-logs.test.ts`

- [ ] **Step 3: Wire routes in `admin-routes.ts`**

Add imports + default store helper + endpoints after auth (near health handlers):

```ts
import { createApiCallLogStore, type ApiCallLogStore } from './api-call-log-store.js';
import {
  isDiagnosticsGateEnabled,
  isDiagnosticsWritable,
  readDiagnosticsFlags,
  resolveApiCallLogFilePath,
  writeDiagnosticsFlags,
} from './diagnostics-settings.js';

export interface AdminRouteDeps {
  apiCallLogStore: ApiCallLogStore;
}

// inside maybeHandleAdminRoute after requireAdminAuth / stores created:
const apiCallLogStore = deps?.apiCallLogStore ?? createApiCallLogStore({
  maxEntries: 500,
  logFilePath: isDiagnosticsWritable(config) ? resolveApiCallLogFilePath(config) : null,
});

if (req.method === 'GET' && normalizedPathname === '/admin/api/diagnostics') {
  const flags = readDiagnosticsFlags(config);
  sendJson(res, 200, {
    debugMode: flags.debugMode,
    logToFile: flags.logToFile,
    gateEnabled: isDiagnosticsGateEnabled(flags),
    writable: isDiagnosticsWritable(config),
    logFilePath: resolveApiCallLogFilePath(config),
    ringSize: apiCallLogStore.maxEntries,
    entryCount: apiCallLogStore.size(),
  });
  return true;
}

if (req.method === 'PATCH' && normalizedPathname === '/admin/api/diagnostics') {
  const body = await parseJsonBody(req, config.maxJsonBytes);
  const flags = writeDiagnosticsFlags(config, {
    debugMode: typeof body.debugMode === 'boolean' ? body.debugMode : undefined,
    logToFile: typeof body.logToFile === 'boolean' ? body.logToFile : undefined,
  });
  sendJson(res, 200, {
    ok: true,
    debugMode: flags.debugMode,
    logToFile: flags.logToFile,
    gateEnabled: isDiagnosticsGateEnabled(flags),
    writable: isDiagnosticsWritable(config),
    logFilePath: resolveApiCallLogFilePath(config),
    ringSize: apiCallLogStore.maxEntries,
    entryCount: apiCallLogStore.size(),
  });
  return true;
}

if (req.method === 'GET' && normalizedPathname === '/admin/api/logs') {
  const flags = readDiagnosticsFlags(config);
  if (!isDiagnosticsGateEnabled(flags)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Enable Debug Mode and Log to File to view API logs.');
  }
  const statusClass = url.searchParams.get('statusClass') ?? undefined;
  const routeFamily = url.searchParams.get('routeFamily') ?? undefined;
  const method = url.searchParams.get('method') ?? undefined;
  const search = url.searchParams.get('search') ?? undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  sendJson(res, 200, {
    entries: apiCallLogStore.list({
      limit: Number.isFinite(limit) ? limit : undefined,
      statusClass: statusClass === '2xx' || statusClass === '4xx' || statusClass === '5xx' ? statusClass : undefined,
      routeFamily: routeFamily || undefined,
      method: method || undefined,
      search: search || undefined,
    }),
  });
  return true;
}

if (req.method === 'DELETE' && normalizedPathname === '/admin/api/logs') {
  if (!isDiagnosticsWritable(config)) {
    throw new GatewayError(409, 'VALIDATION_FAILED', 'Diagnostics log store is not writable.');
  }
  apiCallLogStore.clear();
  sendJson(res, 200, { ok: true, cleared: true });
  return true;
}
```

Update function signature of `maybeHandleAdminRoute` to accept `deps?: AdminRouteDeps` as last arg.

- [ ] **Step 4: Do not expect full suite green until Task 4 capture exists** — keep this task focused on routes compiling; if tests need capture, implement Task 4 next in same branch without separate “done” claim until both pass.

- [ ] **Step 5: Commit routes wiring (can combine with Task 4 if preferred)**

```bash
git add src/admin/admin-routes.ts test/admin-diagnostics-logs.test.ts
git commit -m "feat(admin): add diagnostics and logs API routes"
```

---

### Task 4: Capture hook in `createApp`

**Files:**
- Modify: `src/app.ts`
- Modify: `test/admin-diagnostics-logs.test.ts` (ensure green)

**Interfaces:**
- Consumes: store + `readDiagnosticsFlags` / `isDiagnosticsGateEnabled` / `maskGatewayKeyPreview`
- Produces: side-effect recording for in-scope public routes when gate ON

- [ ] **Step 1: Extend app to own the store and pass deps**

In `createApp`:

```ts
import { createApiCallLogStore, maskGatewayKeyPreview } from './admin/api-call-log-store.js';
import {
  isDiagnosticsGateEnabled,
  isDiagnosticsWritable,
  readDiagnosticsFlags,
  resolveApiCallLogFilePath,
} from './admin/diagnostics-settings.js';

const apiCallLogStore = createApiCallLogStore({
  maxEntries: 500,
  logFilePath: isDiagnosticsWritable(activeConfig) ? resolveApiCallLogFilePath(activeConfig) : null,
});

// when reloadActiveConfig runs, do NOT recreate store (memory retained); file path is fixed from initial dir.
// If adminFileStoreDir can change at runtime in future, revisit — currently stable per process.
```

Pass store into admin:

```ts
if (await maybeHandleAdminRoute(req, res, url, activeConfig, runtime ?? undefined, reloadActiveConfig, { apiCallLogStore })) {
  return;
}
```

- [ ] **Step 2: Record after public gateway handling**

Inside the request handler, after `classifyRoute` succeeds for `gemini`/`openai` only (not health), track `route`, `gatewayKey`, and in a `finally`/`try` path that always runs when a classified public API attempt finished (including auth failures **after** classify? Spec: 401/403 on in-scope public routes may be recorded.

Order today:
1. admin handled
2. cors/options/docs/health
3. `classifyRoute` (throws 404 if unknown)
4. `requireGatewayAuth` (throws 401)
5. dispatch

Implement capture helper:

```ts
const maybeRecordApiCall = (args: {
  route: ReturnType<typeof classifyRoute>;
  method: string;
  path: string;
  statusCode: number;
  startedAt: number;
  requestId: string;
  gatewayKey: string | null;
  errorCode?: string | null;
  model?: string;
}) => {
  const flags = readDiagnosticsFlags(activeConfig);
  if (!isDiagnosticsGateEnabled(flags)) return;
  if (args.route.family !== 'gemini' && args.route.family !== 'openai') return;
  apiCallLogStore.record({
    requestId: args.requestId,
    method: args.method,
    path: args.path,
    statusCode: args.statusCode || 500,
    latencyMs: Date.now() - args.startedAt,
    routeFamily: args.route.family,
    operation: args.route.operation,
    model: args.model ?? args.route.model,
    gatewayKeyPreview: maskGatewayKeyPreview(args.gatewayKey),
    upstreamTarget: null,
    errorCode: args.errorCode ?? null,
  });
};
```

Wire:
- After successful dispatch return, call `maybeRecordApiCall` with `res.statusCode` (default 200 if unset)
- In `catch`, if `route` was classified as gemini/openai, record with GatewayError status/code when available
- Ensure auth failures after successful classify are recorded (move `classifyRoute` before auth already is; capture in catch when `classifiedRoute` variable set)

Refactor try-block to:

```ts
let classified: ReturnType<typeof classifyRoute> | null = null;
let gatewayKey: string | null = null;
try {
  // ... admin, public non-api routes ...
  classified = classifyRoute(req.method ?? 'GET', url.pathname);
  // skip health family (should not reach here for healthz)
  errorFormat = errorFormatForFamily(classified.family);
  requireGatewayAuth(req, activeConfig);
  gatewayKey = extractGatewayKey(req);
  // ... body + dispatch ...
  maybeRecordApiCall({
    route: classified,
    method: req.method ?? 'GET',
    path: url.pathname + url.search,
    statusCode: res.statusCode || 200,
    startedAt: ctx.startedAt,
    requestId: ctx.id,
    gatewayKey,
    model: typeof resolvedBody.model === 'string' ? resolvedBody.model : classified.model,
  });
} catch (error) {
  if (classified && (classified.family === 'gemini' || classified.family === 'openai')) {
    const statusCode = error instanceof GatewayError ? error.statusCode : (res.statusCode || 500);
    maybeRecordApiCall({
      route: classified,
      method: req.method ?? 'GET',
      path: url.pathname + (url.search || ''),
      statusCode,
      startedAt: ctx.startedAt,
      requestId: ctx.id,
      gatewayKey,
      errorCode: error instanceof GatewayError ? error.code : 'INTERNAL',
      model: classified.model,
    });
  }
  // existing error handling...
}
```

Do **not** double-record: only record in success path OR catch, not both. Structure with a local `recorded` flag or only record in `finally` once using last known status.

Preferred single `finally` pattern:

```ts
let classified: ... = null;
let gatewayKey: string | null = null;
let captureModel: string | undefined;
let captureErrorCode: string | null = null;
try {
  ...
  classified = classifyRoute(...);
  requireGatewayAuth(...);
  gatewayKey = extractGatewayKey(req);
  ...
  await dispatch.run(...);
} catch (error) {
  if (error instanceof GatewayError) captureErrorCode = error.code;
  // existing sendError logic
} finally {
  if (classified && (classified.family === 'gemini' || classified.family === 'openai')) {
    maybeRecordApiCall({ ..., statusCode: res.statusCode || (captureErrorCode ? 500 : 200), errorCode: captureErrorCode, model: captureModel ?? classified.model });
  }
  ctx.log('request.complete', ...);
}
```

Ensure `sendError` sets `res.statusCode` before finally (existing helper should).

- [ ] **Step 3: Recreate store file path when config dir present**

On first load, if `logFilePath` is null because static, store still works memory-only but gate cannot enable — OK.

When file-store writable, pass path at construction. If tests mutate config dir only via testConfig at boot, fine.

- [ ] **Step 4: Run tests**

Run:
```bash
npm test -- test/admin-diagnostics-logs.test.ts test/api-call-log-store.test.ts test/diagnostics-settings.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/admin/admin-routes.ts test/admin-diagnostics-logs.test.ts
git commit -m "feat(gateway): capture public API calls into diagnostics log store"
```

---

### Task 5: Frontend API client + types

**Files:**
- Modify: `frontend/src/types/admin.ts`
- Modify: `frontend/src/lib/admin-dashboard-api.ts`
- Optional test: extend pure mapping tests if any exist

**Interfaces:**
- Produces frontend types/functions:

```ts
export type ApiCallStatusClass = '2xx' | '4xx' | '5xx';
export interface DiagnosticsSnapshot {
  debugMode: boolean;
  logToFile: boolean;
  gateEnabled: boolean;
  writable: boolean;
  logFilePath?: string | null;
  ringSize: number;
  entryCount: number;
}
export interface ApiCallLogEntry {
  id: string;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  statusClass: ApiCallStatusClass;
  latencyMs: number;
  routeFamily: string;
  operation: string;
  model?: string;
  gatewayKeyPreview?: string | null;
  upstreamTarget?: string | null;
  errorCode?: string | null;
}
```

```ts
export async function fetchDiagnostics(options: AdminApiOptions): Promise<DiagnosticsSnapshot>
export async function updateDiagnostics(options: AdminApiOptions, patch: { debugMode?: boolean; logToFile?: boolean }): Promise<DiagnosticsSnapshot>
export async function fetchApiLogs(options: AdminApiOptions, query?: { limit?: number; statusClass?: string; routeFamily?: string; method?: string; search?: string }): Promise<{ entries: ApiCallLogEntry[] }>
export async function clearApiLogs(options: AdminApiOptions): Promise<{ ok: true; cleared: true }>
```

- [ ] **Step 1: Add types + API functions using existing `adminFetch` patterns from `admin-dashboard-api.ts`**

```ts
export async function fetchDiagnostics(options: AdminApiOptions) {
  return adminFetch<DiagnosticsSnapshot>('/admin/api/diagnostics', options);
}

export async function updateDiagnostics(
  options: AdminApiOptions,
  patch: { debugMode?: boolean; logToFile?: boolean },
) {
  return adminFetch<DiagnosticsSnapshot & { ok?: true }>('/admin/api/diagnostics', options, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchApiLogs(
  options: AdminApiOptions,
  query: { limit?: number; statusClass?: string; routeFamily?: string; method?: string; search?: string } = {},
) {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.statusClass) params.set('statusClass', query.statusClass);
  if (query.routeFamily) params.set('routeFamily', query.routeFamily);
  if (query.method) params.set('method', query.method);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return adminFetch<{ entries: ApiCallLogEntry[] }>(`/admin/api/logs${qs ? `?${qs}` : ''}`, options);
}

export async function clearApiLogs(options: AdminApiOptions) {
  return adminFetch<{ ok: true; cleared: true }>('/admin/api/logs', options, { method: 'DELETE' });
}
```

- [ ] **Step 2: `npm --prefix frontend run build`** after later UI tasks; for this task ensure TypeScript accepts new exports.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/admin.ts frontend/src/lib/admin-dashboard-api.ts
git commit -m "feat(admin-ui): add diagnostics and logs API client"
```

---

### Task 6: Cấu hình Logging & Diagnostics toggles

**Files:**
- Create: `frontend/src/hooks/useDiagnostics.ts`
- Create: `frontend/src/components/console/DiagnosticsSettingsPanel.tsx` (or inline section in view)
- Modify: `frontend/src/pages/AIProvidersView.tsx`

**Interfaces:**
- `useDiagnostics(token: string)` → `{ data, loading, error, refetch, setFlags, updating }`

- [ ] **Step 1: Implement hook**

```ts
// frontend/src/hooks/useDiagnostics.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchDiagnostics, updateDiagnostics } from '@/lib/admin-dashboard-api';
import type { DiagnosticsSnapshot } from '@/types/admin';

export function useDiagnostics(token: string) {
  const [data, setData] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDiagnostics({ token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void refetch(); }, [refetch]);

  const setFlags = async (patch: { debugMode?: boolean; logToFile?: boolean }) => {
    setUpdating(true);
    setError(null);
    try {
      const next = await updateDiagnostics({ token }, patch);
      setData(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update diagnostics');
      throw err;
    } finally {
      setUpdating(false);
    }
  };

  return { data, loading, updating, error, refetch, setFlags };
}
```

- [ ] **Step 2: UI section in `AIProvidersView`**

Because there is no Switch component, use accessible checkbox buttons or `button` toggles with `role="switch"` + `aria-checked`:

```tsx
<section className="operator-panel space-y-4 p-4">
  <div>
    <h2 className="text-lg font-semibold">Logging &amp; Diagnostics</h2>
    <p className="text-sm text-muted-foreground">Bật cả Debug Mode và Log to File để ghi và xem Nhật ký API.</p>
  </div>
  {!diagnostics.data?.writable && (
    <p className="text-sm text-amber-500">Cần admin file-store (ghi được) để dùng diagnostics.</p>
  )}
  {/* two switches bound to diagnostics.data.debugMode / logToFile, disabled when !writable || updating */}
</section>
```

- [ ] **Step 3: Build frontend**

Run: `npm --prefix frontend run build`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useDiagnostics.ts frontend/src/pages/AIProvidersView.tsx frontend/src/components/console/DiagnosticsSettingsPanel.tsx
git commit -m "feat(admin-ui): add logging diagnostics toggles to configuration"
```

---

### Task 7: Live Nhật ký API view (toolbar, filters, raw)

**Files:**
- Create: `frontend/src/hooks/useApiLogs.ts`
- Modify: `frontend/src/pages/LogsViewerView.tsx`
- Modify: `frontend/src/components/console/ApiLogsTable.tsx`
- Modify: `frontend/src/lib/table.ts`, `frontend/src/hooks/useLogTable.ts`
- Migrate row type from `mockData` → `types/admin` `ApiCallLogEntry` mapped to table row if needed

**Interfaces:**
- `useApiLogs({ token, enabled, filters })` with `rows`, `refresh`, `autoRefresh`, `setAutoRefresh`, `clear`, `loading`, `error`

Behavior:
- Refresh → `fetchApiLogs`
- Auto Refresh default OFF; when ON and `enabled` and mounted, `setInterval` 5000ms
- Clear → `window.confirm('Xóa toàn bộ log trong bộ nhớ và file log hiện tại?')` then `clearApiLogs`
- Show Raw Logs toggle: if ON, render mono lines:  
  `${timestamp} ${statusClass} ${method} ${path} ${latencyMs}ms ${operation}`
- Filters: statusClass, routeFamily, method, search (wire query params to API; client sort optional)
- Empty: `Chưa có API call nào được ghi.`
- Remove beta mock warning when live

Table columns align with schema: time(timestamp), routeFamily, model, latencyMs, status(statusClass), operation, gateway key(gatewayKeyPreview), target(upstreamTarget), plus method/path optional columns or raw mode.

- [ ] **Step 1: Implement `useApiLogs`**

```ts
// frontend/src/hooks/useApiLogs.ts
import { useCallback, useEffect, useState } from 'react';
import { clearApiLogs, fetchApiLogs } from '@/lib/admin-dashboard-api';
import type { ApiCallLogEntry } from '@/types/admin';

export function useApiLogs(token: string, enabled: boolean, query: {
  statusClass?: string;
  routeFamily?: string;
  method?: string;
  search?: string;
  limit?: number;
}) {
  const [entries, setEntries] = useState<ApiCallLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApiLogs({ token }, query);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [token, enabled, query.statusClass, query.routeFamily, query.method, query.search, query.limit]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || !enabled) return;
    const id = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, enabled, refresh]);

  const clear = async () => {
    if (!window.confirm('Xóa toàn bộ log trong bộ nhớ và file log hiện tại?')) return;
    await clearApiLogs({ token });
    setEntries([]);
  };

  return { entries, loading, error, refresh, autoRefresh, setAutoRefresh, clear };
}
```

- [ ] **Step 2: Rebuild `LogsViewerView` with toolbar + table/raw**

- [ ] **Step 3: Update `ApiLogsTable` to accept `ApiCallLogEntry[]` (map `statusClass` → badge, `timestamp` → time cell, `gatewayKeyPreview`)**

- [ ] **Step 4: Frontend build**

Run: `npm --prefix frontend run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useApiLogs.ts frontend/src/pages/LogsViewerView.tsx frontend/src/components/console/ApiLogsTable.tsx frontend/src/lib/table.ts frontend/src/hooks/useLogTable.ts
git commit -m "feat(admin-ui): wire live API logs viewer with refresh and clear"
```

---

### Task 8: Nav gate + deep-link fallback + shell filtering

**Files:**
- Modify: `frontend/src/pages/AdminApp.tsx`
- Modify: `frontend/src/components/stitch/StitchConsoleShell.tsx`
- Modify: `frontend/src/hooks/useAdminView.ts`
- Modify: `frontend/src/data/admin-static.ts` (description can drop “beta”)

**Behavior:**
- Load diagnostics in `AdminApp` via `useDiagnostics(token)`
- Pass `gateEnabled` into shell
- Shell filters nav: hide `logs-viewer` unless `gateEnabled`
- If `view === 'logs-viewer' && !gateEnabled`: `setView('dashboard')` and set banner state:  
  `Bật Debug Mode và Log to File trong Cấu hình để xem Nhật ký API.`
- `LogsViewerView` receives `token` + only rendered when gate ON

- [ ] **Step 1: Implement gating in AdminApp**

```tsx
const diagnostics = useDiagnostics(token);
const gateEnabled = diagnostics.data?.gateEnabled === true;

useEffect(() => {
  if (view === 'logs-viewer' && diagnostics.data && !gateEnabled) {
    setView('dashboard');
    setGateBanner('Bật Debug Mode và Log to File trong Cấu hình để xem Nhật ký API.');
  }
}, [view, gateEnabled, diagnostics.data, setView]);
```

- [ ] **Step 2: Shell accepts `navItems` or `gateEnabled` and filters `adminNavItems`**

```ts
const visibleNav = adminNavItems.filter((item) => item.id !== 'logs-viewer' || gateEnabled);
```

- [ ] **Step 3: Build frontend**

Run: `npm --prefix frontend run build`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AdminApp.tsx frontend/src/components/stitch/StitchConsoleShell.tsx frontend/src/hooks/useAdminView.ts frontend/src/data/admin-static.ts
git commit -m "feat(admin-ui): gate logs navigation behind diagnostics flags"
```

---

### Task 9: Dashboard mock removal + live preview / CTA

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/data/mockData.ts` (remove `apiLogs` export if unused; keep only if tests need — prefer delete mock rows)

**Behavior:**
- Remove `import { apiLogs }` mock panel content
- Props: pass `token` + `gateEnabled` (or diagnostics) into Dashboard
- Gate ON: fetch top 5 logs, show compact `ApiLogsTable`, link/button `Xem tất cả` → `setView('logs-viewer')`
- Gate OFF: CTA panel text to enable diagnostics in Cấu hình — never fake rows

- [ ] **Step 1: Update Dashboard**

```tsx
// Gate OFF
<StitchPanel title="Nhật ký API gần đây" description="Diagnostics đang tắt">
  <p className="p-4 text-sm text-muted-foreground">
    Bật Debug Mode và Log to File trong Cấu hình để ghi và xem Nhật ký API.
  </p>
</StitchPanel>

// Gate ON
<StitchPanel title="Nhật ký API gần đây" description="Live" actions={...}>
  <ApiLogsTable rows={previewRows} standalone={false} />
</StitchPanel>
```

- [ ] **Step 2: Grep remove dead mock usage**

Run: `rg "apiLogs" frontend src test`

Expected: no remaining production mock usage for logs

- [ ] **Step 3: Build + backend tests**

```bash
npm test -- test/api-call-log-store.test.ts test/diagnostics-settings.test.ts test/admin-diagnostics-logs.test.ts
npm --prefix frontend run build
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/data/mockData.ts frontend/src/pages/AdminApp.tsx
git commit -m "feat(admin-ui): replace mock dashboard logs with gated live preview"
```

---

### Task 10: Final verification + workflow status

**Files:**
- Modify: `workflows/api-call-log-tracking.md` status → `ready` / `implemented` note only after code ships; for plan completion set status to **ready for implementation** if still pending
- Modify: `NOTES.md` open questions cleared

- [ ] **Step 1: Full relevant test pass**

```bash
npm test -- test/api-call-log-store.test.ts test/diagnostics-settings.test.ts test/admin-diagnostics-logs.test.ts test/admin-routes.test.ts
npm --prefix frontend run build
```

Expected: all PASS

- [ ] **Step 2: Manual checklist (local file-store)**

1. Login admin
2. Cấu hình → enable both toggles
3. Nav shows Nhật ký API
4. Call `GET /openai/v1/models` with gateway key
5. Refresh logs → row appears; raw toggle works
6. Auto Refresh ON → new traffic appears within 5s
7. Clear → confirm → empty
8. Disable one toggle → nav hides; deep-link `?view=logs-viewer` → dashboard banner
9. Confirm `admin-settings.json` has flags; log file under `logs/api-calls.log` when gate was ON

- [ ] **Step 3: Commit docs status**

```bash
git add workflows/api-call-log-tracking.md NOTES.md
git commit -m "docs: mark api call log tracking workflow ready"
```

---

## Self-review

### 1. Spec coverage
| Spec item | Task |
|-----------|------|
| Hybrid A structured + raw | 7 |
| Gate AND capture+UI | 2, 4, 6, 8 |
| Dual-write ring 500 + JSONL rotate 10MB | 1 |
| Metadata schema + redaction | 1, 4 |
| Toolbar Refresh/AutoRefresh/Clear | 7 |
| Capture public gemini/openai only | 4 |
| Settings in Cấu hình | 6 |
| Persist file-store only | 2, 3 |
| Filters + deep-link | 7, 8 |
| Admin APIs diagnostics/logs | 3 |
| Gate OFF keep data; GET 409 | 1, 3 |
| Dashboard no mock | 9 |
| No Download/SSE/hydrate | out of scope |

### 2. Placeholder scan
No TBD/TODO steps left in tasks; exact commands and code included.

### 3. Type consistency
- Backend `ApiCallLogEntry` fields match frontend `ApiCallLogEntry`
- Endpoints paths `/admin/api/diagnostics` and `/admin/api/logs` consistent across tasks 3–7
- Gate field name `gateEnabled` consistent
- Store shared via `AdminRouteDeps.apiCallLogStore` + app singleton

### Residual implementer notes
- Upstream target id may remain `null` in v1 unless dispatch exposes selected pool target easily — do not block on it
- If `/openai/v1/models` integration test needs model catalog mocks, copy patterns from `test/openai-compatible-routes.test.ts` / existing admin runtime fakes
- Do not log secrets in `ctx.log` beyond existing redaction
