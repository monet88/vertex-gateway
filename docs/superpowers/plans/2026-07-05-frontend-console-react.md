# Frontend Console React Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách Vertex Gateway Admin Console thành một dự án Vite + React + TypeScript độc lập tại `frontend/`, đồng bộ thiết kế mới từ Stitch, rồi nâng cấp các vùng tương tác bằng shadcn/ui.

**Architecture:** `frontend/` là app SPA độc lập, gọi các admin API hiện có qua `fetch` với admin token lưu trong `sessionStorage`. Thiết kế lấy `DESIGN.md` làm nguồn token chính; Stitch export chỉ dùng làm base layout/component, không để hex rải rác trong component. shadcn/ui chỉ dùng cho primitive cần thiết: table, dialog, form/input, button, badge, select.

**Tech Stack:** Vite React TypeScript, React, Tailwind CSS v4, shadcn/ui, Radix-backed components, local React state, CSS variables.

**Required skills during execution:**
- Before starting implementation: activate `superpowers:using-git-worktrees`, then use either `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
- Before writing or modifying React components/hooks: activate `react-patterns`.
- Before any Stitch export/sync work in Task 4: activate `stitch-react-components` and follow its MCP/download/visual-audit gates exactly.
- Before shadcn setup or component upgrades in Tasks 3, 5, and 6: activate `shadcn-ui`.
- Before final UI polish/accessibility pass: activate `accessibility` if interactive behavior, focus management, or Dialog/Table semantics are changed.

---

## Scope check

Plan cũ tập trung backend admin API. Plan này thay thế phần frontend console: tạo app React độc lập và áp thiết kế mới. Không thêm database, không đổi backend API, không nhúng React build vào server trong vòng này.

Nguồn cần giữ đúng:

- Root design file: `DESIGN.md`.
- Stitch project: `8768885988464027333`.
- Target React component folder: `frontend/src/components`.
- Không hiển thị raw Gateway key hoặc Google Vertex API key mặc định.

---

## File structure

### Create by scaffold

- `frontend/package.json` - Vite React app scripts and dependencies.
- `frontend/index.html` - Vite app shell.
- `frontend/src/main.tsx` - React entry point.
- `frontend/src/App.tsx` - Admin console composition root.
- `frontend/src/index.css` - Tailwind v4 import, design tokens, shadcn CSS variables.

### Create manually after scaffold

- `frontend/components.json` - shadcn/ui config.
- `frontend/tsconfig.app.json` - path alias support if shadcn init does not add it.
- `frontend/vite.config.ts` - React + Tailwind plugin + `@` alias.
- `frontend/src/lib/utils.ts` - shadcn `cn()` helper.
- `frontend/src/lib/admin-api.ts` - small fetch wrapper for admin API calls.
- `frontend/src/lib/table.ts` - pure filter/sort helpers for logs table.
- `frontend/src/data/mockData.ts` - Stitch/static fallback data only.
- `frontend/src/hooks/useAdminToken.ts` - sessionStorage token state.
- `frontend/src/hooks/useLogTable.ts` - logs filter/sort state.
- `frontend/src/components/ui/*` - shadcn copied components.
- `frontend/src/components/console/*` - composed console components.
- `frontend/src/components/stitch/*` - Stitch-exported base components.

### Root files to modify

- `docs/superpowers/plans/2026-07-05-frontend-console-react.md` - this plan only.
- Later optional backend integration docs can modify `README.md`, but not in this plan.

---

## Task 1: Scaffold Vite React TypeScript app

**Files:**
- Create: `frontend/*`

- [ ] **Step 1: Confirm `frontend/` does not already contain a Vite app**

Run from repo root:

```bash
test ! -f frontend/package.json
```

Expected: exit code `0`.

If it fails, stop and report that `frontend/package.json` already exists instead of overwriting it.

- [ ] **Step 2: Create the Vite app exactly as requested**

Run from repo root:

```bash
npx -y create-vite@latest frontend -- --template react-ts
```

Expected: files are created under `frontend/`.

Source note: Vite documents scaffolding via `npm create vite@latest my-app -- --template react`; this plan uses the requested non-interactive `npx -y create-vite@latest frontend -- --template react-ts` form.

- [ ] **Step 3: Install scaffold dependencies**

Run:

```bash
cd frontend && npm install
```

Expected: `frontend/node_modules` and `frontend/package-lock.json` are created.

- [ ] **Step 4: Verify clean scaffold build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS with `vite build` output and no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat: scaffold frontend console app"
```

---

## Task 2: Install Tailwind v4 and encode DESIGN.md tokens

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Replace: `frontend/src/index.css`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Install Tailwind v4 Vite integration**

Run:

```bash
cd frontend && npm install tailwindcss @tailwindcss/vite
```

Expected: dependencies are added to `frontend/package.json`.

Source note: shadcn/ui Vite docs specify `npm install tailwindcss @tailwindcss/vite` and `@import "tailwindcss";` in `src/index.css`.

- [ ] **Step 2: Configure Vite plugins and alias**

Replace `frontend/vite.config.ts` with:

```typescript
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 3: Add `@` path alias to TypeScript**

Open `frontend/tsconfig.app.json` and ensure `compilerOptions` contains:

```json
{
  "baseUrl": ".",
  "paths": {
    "@/*": ["./src/*"]
  }
}
```

Do not remove existing Vite options; merge these keys into the existing `compilerOptions` object.

- [ ] **Step 4: Replace global CSS with design tokens**

Replace `frontend/src/index.css` with:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --font-sans: Geist, ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  color-scheme: dark;
  --radius: 0.75rem;

  --console-canvas: #0b1020;
  --console-surface: #111827;
  --console-input: #0f172a;
  --console-surface-high: #1e293b;
  --console-line: #263244;
  --console-ink: #e5e7eb;
  --console-muted: #94a3b8;
  --operator-teal: #2dd4bf;
  --healthy-green: #22c55e;
  --warning-amber: #f59e0b;
  --failure-red: #ef4444;

  --background: var(--console-canvas);
  --foreground: var(--console-ink);
  --card: var(--console-surface);
  --card-foreground: var(--console-ink);
  --popover: var(--console-surface-high);
  --popover-foreground: var(--console-ink);
  --primary: var(--operator-teal);
  --primary-foreground: var(--console-canvas);
  --secondary: var(--console-surface-high);
  --secondary-foreground: var(--console-ink);
  --muted: var(--console-input);
  --muted-foreground: var(--console-muted);
  --accent: var(--operator-teal);
  --accent-foreground: var(--console-canvas);
  --destructive: var(--failure-red);
  --border: var(--console-line);
  --input: var(--console-input);
  --ring: var(--operator-teal);
}

html {
  background: var(--background);
}

body {
  min-width: 320px;
  min-height: 100dvh;
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(45, 212, 191, 0.08), transparent 34rem),
    var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

button,
input,
select,
textarea {
  font: inherit;
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--operator-teal);
  outline-offset: 2px;
}

.tabular-data {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Force dark theme at app root**

Replace `frontend/src/main.tsx` with:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="dark min-h-dvh bg-background text-foreground">
      <App />
    </div>
  </StrictMode>,
);
```

- [ ] **Step 6: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig.app.json frontend/src/index.css frontend/src/main.tsx
git commit -m "feat: add console design tokens"
```

---

## Task 3: Initialize shadcn/ui for Vite

**Files:**
- Create: `frontend/components.json`
- Create: `frontend/src/lib/utils.ts`
- Create: `frontend/src/components/ui/*`
- Modify: `frontend/package.json`

- [ ] **Step 1: Initialize shadcn/ui**

Run:

```bash
cd frontend && npx shadcn@latest init
```

Choose these answers if prompted:

```text
Style: New York
Base color: Slate
CSS variables: yes
Use React Server Components: no
Components alias: @/components
Utils alias: @/lib/utils
```

If the current CLI accepts flags instead of prompts, use the equivalent non-interactive options and keep `cssVariables` enabled.

- [ ] **Step 2: Ensure `components.json` matches the Vite app**

After init, make sure `frontend/components.json` contains these values:

```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

If the generated file has extra CLI-owned keys, keep them. The keys above must be present and equivalent.

- [ ] **Step 3: Add only required shadcn components**

Run:

```bash
cd frontend && npx shadcn@latest add button badge table dialog input label select textarea separator card
```

Expected: files are created under `frontend/src/components/ui/` and dependencies are added.

- [ ] **Step 4: Verify `cn()` helper exists**

Ensure `frontend/src/lib/utils.ts` contains:

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: initialize shadcn ui"
```

---

## Task 4: Fetch and export Stitch screens into React base components

**Files:**
- Create: `frontend/.stitch/metadata.json`
- Create: `.stitch/metadata.json`
- Create: `frontend/.stitch/designs/*`
- Create: `frontend/src/components/stitch/*`
- Create: `frontend/src/data/mockData.ts`

- [ ] **Step 1: Use Stitch React Components skill gate**

Follow `stitch-react-components` Phase 1 exactly:

1. Discover Stitch MCP namespace.
2. Fetch project `8768885988464027333` with Stitch MCP.
3. Fetch every screen in the project with Stitch MCP `get_screen`.
4. If `frontend/.stitch/designs/*.html` or `frontend/.stitch/designs/*.png` already exists, stop and ask whether to refresh or reuse.
5. Download each screen HTML and PNG through:

```bash
bash scripts/fetch-stitch.sh "[htmlCode.downloadUrl]" "frontend/.stitch/designs/[screen-label].html"
bash scripts/fetch-stitch.sh "[screenshot.downloadUrl]=w[width]" "frontend/.stitch/designs/[screen-label].png"
```

6. Visually inspect every downloaded PNG.
7. Save metadata to both:

```text
frontend/.stitch/metadata.json
.stitch/metadata.json
```

The metadata must include `projectId`, `title`, `deviceType`, `Last Sync Time`, and a `screens` map with screen id, label, source screen, dimensions, and canvas position.

- [ ] **Step 2: Extract style guide from Stitch HTML**

Follow `stitch-react-components` Phase 2 exactly:

- Extract `tailwind.config` from each downloaded HTML `<head>`.
- Save current tokens to `frontend/resources/style-guide.json`.
- Map Stitch token names to existing CSS variables from Task 2 instead of adding arbitrary hex inside components.

The primary mapping must be:

```json
{
  "Deep Console Canvas": "var(--console-canvas)",
  "Raised Console Surface": "var(--console-surface)",
  "Pressed Input Well": "var(--console-input)",
  "Layered Surface High": "var(--console-surface-high)",
  "Quiet Hairline": "var(--console-line)",
  "Primary Ink": "var(--console-ink)",
  "Muted Ink": "var(--console-muted)",
  "Operator Teal": "var(--operator-teal)",
  "Healthy Green": "var(--healthy-green)",
  "Warning Amber": "var(--warning-amber)",
  "Failure Red": "var(--failure-red)"
}
```

- [ ] **Step 3: Create static mock data from design content**

Create `frontend/src/data/mockData.ts`:

```typescript
export type RouteFamily = 'gemini' | 'openai' | 'vertex' | 'vtx' | 'custom';
export type LogStatus = '2xx' | '4xx' | '5xx';

export interface ApiLogRow {
  id: string;
  time: string;
  routeFamily: RouteFamily;
  operation: string;
  model: string;
  gatewayKey: string;
  upstreamTarget: string;
  latencyMs: number;
  status: LogStatus;
}

export interface GatewayKeyRow {
  id: string;
  label: string;
  preview: string;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface VertexTargetRow {
  id: string;
  label: string;
  project: string;
  location: string;
  authType: 'Google Cloud API key' | 'Service Account JSON';
  apiKeyMode: 'full' | 'express';
  health: 'ready' | 'degraded' | 'failed';
}

export const apiLogs: ApiLogRow[] = [
  {
    id: 'req-01jz7w8q4n',
    time: '14:32:08',
    routeFamily: 'gemini',
    operation: 'generateContent',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...q2a',
    upstreamTarget: 'global-primary',
    latencyMs: 842,
    status: '2xx',
  },
  {
    id: 'req-01jz7w91mf',
    time: '14:31:44',
    routeFamily: 'openai',
    operation: 'chatCompletions',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...9kp',
    upstreamTarget: 'asia-failover',
    latencyMs: 1290,
    status: '5xx',
  },
  {
    id: 'req-01jz7w9n7c',
    time: '14:30:12',
    routeFamily: 'vertex',
    operation: 'predict',
    model: 'gemini-3.1-flash-image-preview',
    gatewayKey: 'vgw_...p7m',
    upstreamTarget: 'image-global',
    latencyMs: 2110,
    status: '4xx',
  },
];

export const gatewayKeys: GatewayKeyRow[] = [
  { id: 'key-mobile', label: 'Mobile app', preview: 'vgw_...q2a', status: 'active', createdAt: '2026-07-05' },
  { id: 'key-console', label: 'Admin smoke test', preview: 'vgw_...9kp', status: 'revoked', createdAt: '2026-07-04' },
];

export const vertexTargets: VertexTargetRow[] = [
  {
    id: 'target-global-primary',
    label: 'Global primary',
    project: 'vertex-prod-a',
    location: 'global',
    authType: 'Google Cloud API key',
    apiKeyMode: 'full',
    health: 'ready',
  },
  {
    id: 'target-asia-failover',
    label: 'Asia failover',
    project: 'vertex-prod-b',
    location: 'asia-southeast1',
    authType: 'Service Account JSON',
    apiKeyMode: 'full',
    health: 'degraded',
  },
];
```

- [ ] **Step 4: Export Stitch base components**

Create components under `frontend/src/components/stitch/` from the downloaded Stitch screen HTML. Every file must export a component with a readonly props interface.

Minimum required files:

```text
frontend/src/components/stitch/StitchConsoleShell.tsx
frontend/src/components/stitch/StitchKpiStrip.tsx
frontend/src/components/stitch/StitchSecurityRail.tsx
```

Use this exact prop shape for the shell:

```typescript
import type { ReactNode } from 'react';

export interface StitchConsoleShellProps {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
}

export function StitchConsoleShell({ children, rail }: StitchConsoleShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-card/90 p-4 lg:border-b-0 lg:border-r">
          <a href="/" className="block rounded-lg text-lg font-semibold tracking-tight text-foreground">
            Vertex Gateway Admin
          </a>
          <nav aria-label="Console navigation" className="mt-8 grid gap-2 text-sm text-muted-foreground">
            <a className="rounded-md bg-secondary px-3 py-2 text-foreground" href="#logs">API call logs</a>
            <a className="rounded-md px-3 py-2 hover:bg-secondary hover:text-foreground" href="#keys">Gateway keys</a>
            <a className="rounded-md px-3 py-2 hover:bg-secondary hover:text-foreground" href="#targets">Vertex targets</a>
            <a className="rounded-md px-3 py-2 hover:bg-secondary hover:text-foreground" href="#policy">Domain policy</a>
          </nav>
        </aside>
        <section className="grid gap-4 p-4 xl:grid-cols-[1fr_340px] xl:p-6">
          <div className="min-w-0 space-y-4">{children}</div>
          {rail ? <aside className="space-y-4">{rail}</aside> : null}
        </section>
      </div>
    </main>
  );
}
```

After creating the real Stitch-derived components, remove any duplicate static text from component files by moving data to `frontend/src/data/mockData.ts`.

- [ ] **Step 5: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/.stitch .stitch frontend/resources frontend/src/components/stitch frontend/src/data/mockData.ts
git commit -m "feat: export stitch console components"
```

---

## Task 5: Add log table filter/sort helpers and shadcn table

**Files:**
- Create: `frontend/src/lib/table.ts`
- Create: `frontend/src/hooks/useLogTable.ts`
- Create: `frontend/src/components/console/ApiLogsTable.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create pure table helpers**

Create `frontend/src/lib/table.ts`:

```typescript
import type { ApiLogRow, LogStatus, RouteFamily } from '@/data/mockData';

export type LogSortKey = 'time' | 'latencyMs' | 'status' | 'routeFamily' | 'model';
export type SortDirection = 'asc' | 'desc';

export interface LogTableFilters {
  readonly routeFamily: RouteFamily | 'all';
  readonly status: LogStatus | 'all';
  readonly model: string;
}

export interface LogTableSort {
  readonly key: LogSortKey;
  readonly direction: SortDirection;
}

const compareText = (left: string, right: string): number => left.localeCompare(right);

export function filterLogs(rows: readonly ApiLogRow[], filters: LogTableFilters): ApiLogRow[] {
  const model = filters.model.trim().toLowerCase();
  return rows.filter((row) => {
    const routeMatches = filters.routeFamily === 'all' || row.routeFamily === filters.routeFamily;
    const statusMatches = filters.status === 'all' || row.status === filters.status;
    const modelMatches = model.length === 0 || row.model.toLowerCase().includes(model);
    return routeMatches && statusMatches && modelMatches;
  });
}

export function sortLogs(rows: readonly ApiLogRow[], sort: LogTableSort): ApiLogRow[] {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === 'latencyMs') return (left.latencyMs - right.latencyMs) * multiplier;
    return compareText(String(left[sort.key]), String(right[sort.key])) * multiplier;
  });
}

export function getVisibleLogs(
  rows: readonly ApiLogRow[],
  filters: LogTableFilters,
  sort: LogTableSort,
): ApiLogRow[] {
  return sortLogs(filterLogs(rows, filters), sort);
}
```

- [ ] **Step 2: Create table state hook**

Create `frontend/src/hooks/useLogTable.ts`:

```typescript
import { useMemo, useState } from 'react';
import type { ApiLogRow } from '@/data/mockData';
import { getVisibleLogs, type LogTableFilters, type LogTableSort } from '@/lib/table';

const initialFilters: LogTableFilters = {
  routeFamily: 'all',
  status: 'all',
  model: '',
};

const initialSort: LogTableSort = {
  key: 'time',
  direction: 'desc',
};

export function useLogTable(rows: readonly ApiLogRow[]) {
  const [filters, setFilters] = useState<LogTableFilters>(initialFilters);
  const [sort, setSort] = useState<LogTableSort>(initialSort);
  const visibleRows = useMemo(() => getVisibleLogs(rows, filters, sort), [filters, rows, sort]);

  return {
    filters,
    setFilters,
    sort,
    setSort,
    visibleRows,
  };
}
```

- [ ] **Step 3: Create shadcn table component**

Create `frontend/src/components/console/ApiLogsTable.tsx`:

```typescript
import type { ApiLogRow, LogStatus, RouteFamily } from '@/data/mockData';
import { useLogTable } from '@/hooks/useLogTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ApiLogsTableProps {
  readonly rows: readonly ApiLogRow[];
}

const routeFamilies: Array<RouteFamily | 'all'> = ['all', 'gemini', 'openai', 'vertex', 'vtx', 'custom'];
const statuses: Array<LogStatus | 'all'> = ['all', '2xx', '4xx', '5xx'];

export function ApiLogsTable({ rows }: ApiLogsTableProps) {
  const { filters, setFilters, sort, setSort, visibleRows } = useLogTable(rows);

  const nextDirection = sort.direction === 'asc' ? 'desc' : 'asc';

  return (
    <section id="logs" className="rounded-xl border border-border bg-card shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">API call logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Bảng log đã mask key, lọc theo route family, status và model.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select
            value={filters.routeFamily}
            onValueChange={(value) => setFilters((current) => ({ ...current, routeFamily: value as RouteFamily | 'all' }))}
          >
            <SelectTrigger aria-label="Lọc route family"><SelectValue /></SelectTrigger>
            <SelectContent>{routeFamilies.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(value) => setFilters((current) => ({ ...current, status: value as LogStatus | 'all' }))}
          >
            <SelectTrigger aria-label="Lọc status"><SelectValue /></SelectTrigger>
            <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
          </Select>
          <Input
            aria-label="Lọc model"
            value={filters.model}
            onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
            placeholder="gemini"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table id="api-log-table">
          <TableHeader>
            <TableRow>
              {(['time', 'routeFamily', 'model', 'latencyMs', 'status'] as const).map((key) => (
                <TableHead key={key}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setSort({ key, direction: sort.key === key ? nextDirection : 'asc' })}
                  >
                    {key} {sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                  </Button>
                </TableHead>
              ))}
              <TableHead>operation</TableHead>
              <TableHead>gateway key</TableHead>
              <TableHead>target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="tabular-data">{row.time}</TableCell>
                <TableCell>{row.routeFamily}</TableCell>
                <TableCell className="tabular-data">{row.model}</TableCell>
                <TableCell className="tabular-data">{row.latencyMs}ms</TableCell>
                <TableCell><Badge variant={row.status === '2xx' ? 'default' : 'destructive'}>{row.status}</Badge></TableCell>
                <TableCell>{row.operation}</TableCell>
                <TableCell className="tabular-data">{row.gatewayKey}</TableCell>
                <TableCell>{row.upstreamTarget}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire table into app**

Replace `frontend/src/App.tsx` with:

```typescript
import { apiLogs, gatewayKeys, vertexTargets } from '@/data/mockData';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';

export default function App() {
  return (
    <StitchConsoleShell
      rail={
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Security notices</h2>
          <p className="mt-2 text-sm text-muted-foreground">Token admin phải tách biệt với gateway key.</p>
        </div>
      }
    >
      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Active gateway keys</p>
          <p className="tabular-data mt-2 text-3xl font-semibold">{gatewayKeys.filter((key) => key.status === 'active').length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Vertex targets</p>
          <p className="tabular-data mt-2 text-3xl font-semibold">{vertexTargets.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Recent logs</p>
          <p className="tabular-data mt-2 text-3xl font-semibold">{apiLogs.length}</p>
        </div>
      </section>
      <ApiLogsTable rows={apiLogs} />
    </StitchConsoleShell>
  );
}
```

- [ ] **Step 5: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS. If it fails because a shadcn import is missing, run `npx shadcn@latest add <missing-component>` only for that component.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/table.ts frontend/src/hooks/useLogTable.ts frontend/src/components/console/ApiLogsTable.tsx frontend/src/App.tsx
git commit -m "feat: add console logs data table"
```

---

## Task 6: Add shadcn dialogs and masked secret fields

**Files:**
- Create: `frontend/src/components/console/SecretInput.tsx`
- Create: `frontend/src/components/console/GatewayKeyDialog.tsx`
- Create: `frontend/src/components/console/VertexTargetDialog.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create masked secret input**

Create `frontend/src/components/console/SecretInput.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SecretInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

export function SecretInput({ id, label, value, onChange, placeholder }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);

  async function copyValue() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <Button type="button" variant="secondary" onClick={() => setRevealed((current) => !current)}>
          {revealed ? 'Ẩn' : 'Hiện'}
        </Button>
        <Button type="button" variant="secondary" onClick={copyValue} disabled={!value}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Secret được mask mặc định. Chỉ hiện khi operator chủ động bấm.</p>
    </div>
  );
}
```

- [ ] **Step 2: Create gateway key dialog**

Create `frontend/src/components/console/GatewayKeyDialog.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface GatewayKeyDialogProps {
  readonly onCreate: (label: string) => void;
}

export function GatewayKeyDialog({ onCreate }: GatewayKeyDialogProps) {
  const [label, setLabel] = useState('');

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate(label.trim() || 'Managed key');
    setLabel('');
  }

  return (
    <Dialog>
      <DialogTrigger asChild><Button>Tạo gateway key</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo gateway key</DialogTitle>
          <DialogDescription>Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="gateway-key-label">Tên key</Label>
            <Input id="gateway-key-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Mobile app" />
          </div>
          <Button type="submit">Tạo key</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create Vertex target dialog**

Create `frontend/src/components/console/VertexTargetDialog.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SecretInput } from '@/components/console/SecretInput';

export interface VertexTargetDraft {
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly apiKey: string;
}

export interface VertexTargetDialogProps {
  readonly onCreate: (target: VertexTargetDraft) => void;
}

export function VertexTargetDialog({ onCreate }: VertexTargetDialogProps) {
  const [draft, setDraft] = useState<VertexTargetDraft>({ label: '', project: '', location: 'global', apiKey: '' });

  function patch(update: Partial<VertexTargetDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({ ...draft, label: draft.label.trim() || 'Vertex target' });
    setDraft({ label: '', project: '', location: 'global', apiKey: '' });
  }

  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="secondary">Thêm target</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm Vertex target</DialogTitle>
          <DialogDescription>Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="target-label">Tên target</Label>
            <Input id="target-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} placeholder="Global primary" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="target-project">Project ID</Label>
              <Input id="target-project" value={draft.project} onChange={(event) => patch({ project: event.target.value })} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="target-location">Location</Label>
              <Input id="target-location" value={draft.location} onChange={(event) => patch({ location: event.target.value })} required />
            </div>
          </div>
          <SecretInput id="target-api-key" label="Google Cloud API key" value={draft.apiKey} onChange={(apiKey) => patch({ apiKey })} />
          <Button type="submit">Thêm target</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire dialogs into App**

In `frontend/src/App.tsx`, add imports:

```typescript
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
```

Add actions above the KPI strip inside `<StitchConsoleShell>`:

```tsx
<section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Vertex Gateway Admin</h1>
    <p className="mt-1 text-sm text-muted-foreground">Console tách riêng cho gateway keys, Vertex targets, logs và domain policy.</p>
  </div>
  <div className="flex gap-2">
    <GatewayKeyDialog onCreate={(label) => console.info('create gateway key', label)} />
    <VertexTargetDialog onCreate={(target) => console.info('create vertex target', target.project)} />
  </div>
</section>
```

- [ ] **Step 5: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/console/SecretInput.tsx frontend/src/components/console/GatewayKeyDialog.tsx frontend/src/components/console/VertexTargetDialog.tsx frontend/src/App.tsx
git commit -m "feat: add console mutation dialogs"
```

---

## Task 7: Add minimal admin API wrapper without coupling UI to backend internals

**Files:**
- Create: `frontend/src/lib/admin-api.ts`
- Create: `frontend/src/hooks/useAdminToken.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create fetch wrapper**

Create `frontend/src/lib/admin-api.ts`:

```typescript
export interface AdminApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
}

export async function adminFetch<T>(path: string, options: AdminApiOptions, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${options.baseUrl ?? ''}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Admin API failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 2: Create session token hook**

Create `frontend/src/hooks/useAdminToken.ts`:

```typescript
import { useState } from 'react';

const storageKey = 'vertex-gateway-admin-token';

export function useAdminToken() {
  const [token, setTokenState] = useState(() => sessionStorage.getItem(storageKey) ?? '');

  function setToken(nextToken: string) {
    setTokenState(nextToken);
    if (nextToken) sessionStorage.setItem(storageKey, nextToken);
    else sessionStorage.removeItem(storageKey);
  }

  return { token, setToken };
}
```

- [ ] **Step 3: Add token input to App**

In `frontend/src/App.tsx`, import:

```typescript
import { useAdminToken } from '@/hooks/useAdminToken';
import { SecretInput } from '@/components/console/SecretInput';
```

Inside `App()` add:

```typescript
const { token, setToken } = useAdminToken();
```

Inside the top action section, before dialog buttons, add:

```tsx
<div className="min-w-72">
  <SecretInput id="admin-token" label="Admin token" value={token} onChange={setToken} placeholder="Bearer token" />
</div>
```

Keep dialogs using mock `console.info` in this task; live mutations should be wired only after backend endpoints are stable.

- [ ] **Step 4: Verify build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/admin-api.ts frontend/src/hooks/useAdminToken.ts frontend/src/App.tsx
git commit -m "feat: add admin token handling"
```

---

## Task 8: Final build verification and dependency audit

**Files:**
- Modify: `frontend/package.json` only if scripts need correction.

- [ ] **Step 1: Verify frontend package scripts**

Ensure `frontend/package.json` has these scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Run frontend lint if scaffold provided it**

Run:

```bash
cd frontend && npm run lint
```

Expected: PASS. If lint fails only because generated Stitch markup has rule conflicts, fix the generated component code instead of disabling lint globally.

- [ ] **Step 4: Run root backend checks to ensure frontend addition did not break existing project**

Run from repo root:

```bash
npm run compile
npm test
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "chore: verify frontend console build"
```

---

## Self-review

### Spec coverage

- Giai đoạn 1 scaffold Vite React TypeScript: Task 1.
- Install dependencies and environment: Tasks 1, 2, 3.
- Read and encode `DESIGN.md` tokens: Task 2.
- Use `stitch-react-components` for Stitch project `8768885988464027333`: Task 4.
- Keep token mapping to CSS variables/Tailwind theme: Tasks 2 and 4.
- Use `shadcn-ui`: Task 3.
- Dark mode, Operator Teal, Deep Console Canvas: Task 2 and Task 3.
- Logs table with filter/sort: Task 5.
- Form/Dialog for gateway keys and targets: Task 6.
- Secret mask plus Reveal/Copy: Task 6.
- Build TypeScript clean: Tasks 1, 2, 3, 4, 5, 6, 7, 8.

### Deliberate simplifications

- No backend endpoint changes in this plan; existing backend work remains separate.
- No full routing library yet; single console screen is enough for the first separated frontend.
- No React Query yet; direct `fetch` wrapper is enough until live API caching/retry is needed.
- No DataTable dependency beyond shadcn `Table`; filter/sort is local and small.

### Placeholder scan

No `TBD`, `TODO`, `implement later`, or undefined component names are intended. Generated Stitch component contents are the only runtime-dependent part and must come from the mandatory Stitch fetch/export gate.

### Type consistency

- Log data type: `ApiLogRow`.
- Filter type: `LogTableFilters`.
- Sort type: `LogTableSort`.
- Secret field component: `SecretInput`.
- Admin token storage key: `vertex-gateway-admin-token`.

---

## Recommended execution order

1. Task 1 - scaffold Vite app.
2. Task 2 - Tailwind and design tokens.
3. Task 3 - shadcn init and primitives.
4. Task 4 - Stitch export.
5. Task 5 - logs DataTable.
6. Task 6 - dialogs and secret inputs.
7. Task 7 - admin token wrapper.
8. Task 8 - final verification.

Commit after every task. Do not batch the whole frontend into one commit.
