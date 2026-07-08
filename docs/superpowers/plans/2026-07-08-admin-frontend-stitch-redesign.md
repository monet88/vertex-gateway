# Admin Frontend Stitch Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the redesigned Stitch operator-console screens from project `13996043634571471896` to the live React admin frontend without changing the existing `/admin/api/*` backend contract.

**Architecture:** Keep backend auth, persistence, runtime health, gateway-key, credential, model-catalog, and telemetry contracts unchanged. Implement the redesign as a frontend-only pass: design tokens, shared shell, route labels, reusable operator UI primitives, and page-level layout updates that map the Stitch screens to the current React admin views. Split Gateway Keys and Vertex Auth into first-class admin destinations in the React view model while still reusing the same live `useAdminDashboardData()` data source.

**Tech Stack:** React 19, TypeScript, Vite 8, Tailwind v4, shadcn-style local UI primitives, Radix Dialog/Select, lucide-react, Vitest, oxlint.

## Global Constraints

- Source Stitch project: `https://stitch.withgoogle.com/projects/13996043634571471896`.
- Local Stitch reference files: `.stitch/designs/admin-dashboard.html`, `.stitch/designs/gateway-key-management.html`, `.stitch/designs/vertex-auth.html`, `.stitch/designs/api-call-logs.html`.
- Local design-system source: `frontend/DESIGN.md` and Stitch project design tokens.
- Do not change `/admin/api/*` route behavior or response shapes.
- Do not expose full gateway keys, Google Cloud API keys, service-account private keys, or absolute credential paths.
- Keep operator copy concise and mostly Vietnamese where the redesigned Stitch screens already use Vietnamese labels.
- Use lucide icons already available in the frontend dependency graph; do not add Material Symbols as a runtime dependency.
- Preserve keyboard focus visibility, semantic table markup, and reduced-motion-friendly transitions.
- Cards are for operational groupings only; avoid nested card stacks and generic equal-card dashboard layouts.

---

## Stitch Redesign Inventory

The Stitch project currently contains these relevant desktop screens:

- `Bảng điều khiển Admin` -> target page: `frontend/src/pages/Dashboard.tsx`
- `Quản lý Gateway Key` -> new first-class page: `frontend/src/pages/GatewayKeysView.tsx`
- `Xác thực Vertex AI` -> target page: `frontend/src/pages/AuthFilesView.tsx` plus `frontend/src/pages/AIProvidersView.tsx`
- `Nhật ký cuộc gọi API` -> target page: `frontend/src/pages/LogsViewerView.tsx`
- `DESIGN.md` -> token/style source, already reflected in `frontend/DESIGN.md`

## File Structure

- Modify `frontend/src/index.css`: align CSS custom properties with the Stitch design tokens, add scrollbar, panel, table, status, and motion utility classes.
- Modify `frontend/src/data/admin-static.ts`: change nav labels/descriptions/icons to match Stitch pages and add the new Gateway Keys view.
- Modify `frontend/src/types/admin.ts`: add `gateway-keys` to `AdminViewId`.
- Modify `frontend/src/hooks/useAdminView.ts`: no logic change expected; valid view set follows `adminNavItems` once the new view is added.
- Modify `frontend/src/pages/AdminApp.tsx`: route the new Gateway Keys page, move logout into the redesigned shell action surface, and keep login/password-change gates intact.
- Modify `frontend/src/components/stitch/StitchConsoleShell.tsx`: implement the fixed sidebar, sticky top bar, environment/status badges, icon nav, and action slots from Stitch.
- Modify `frontend/src/components/stitch/StitchKpiStrip.tsx`: tighten KPI tiles to the redesigned compact mono-number style.
- Modify `frontend/src/components/stitch/StitchSecurityRail.tsx`: convert current notice card into the redesigned security rail/panel treatment.
- Create `frontend/src/components/stitch/StitchPageHeader.tsx`: shared page header with title, description, optional warning badge, and action slot.
- Create `frontend/src/components/stitch/StitchPanel.tsx`: shared operational panel wrapper for table/filter/form groupings.
- Modify `frontend/src/components/ui/button-variants.ts`: tune button radius, active feedback, and operator-console focus/hover states.
- Modify `frontend/src/components/ui/badge-variants.ts`: tune semantic status badge styles.
- Modify `frontend/src/components/ui/table.tsx`: apply compact hairline table defaults and hover behavior.
- Modify `frontend/src/components/console/GatewayKeysTable.tsx`: match the redesigned key-management table with masked previews, mono cells, status chips, and icon actions.
- Modify `frontend/src/components/console/VertexTargetsTable.tsx`: match the redesigned Vertex Auth target table with health/status treatment and icon actions.
- Modify `frontend/src/components/console/ApiLogsTable.tsx`: match the redesigned advanced filter bar and wide logs table.
- Modify `frontend/src/components/console/AdminState.tsx`: align loading, empty, beta, and error blocks with the new panel style.
- Modify `frontend/src/pages/Dashboard.tsx`: map Stitch overview: KPI row, dominant recent logs, compact targets/keys summaries, and right security rail.
- Create `frontend/src/pages/GatewayKeysView.tsx`: dedicated Gateway Keys page using existing live gateway-key mutations.
- Modify `frontend/src/pages/AuthFilesView.tsx`: apply the Vertex Auth layout and security explanatory panel for service-account credentials.
- Modify `frontend/src/pages/AIProvidersView.tsx`: keep runtime selection and API-key target operations, but visually align it with the Vertex Auth surface.
- Modify `frontend/src/pages/LogsViewerView.tsx`: apply the logs screen header, filter panel, and beta/live-data messaging.
- Modify `frontend/src/pages/AvailableModelsView.tsx`: align read-only catalog table with the same operator table system.
- Modify `frontend/src/pages/ModelManagementView.tsx`: align catalog editor panels with the same form/input/token styling.
- Modify `test/admin-frontend-helpers.test.ts`: add pure-data tests for nav/view additions and KPI metric derivation if helper extraction is introduced.

### Task 1: Lock The Redesign Tokens And Shared Operator Primitives

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/ui/button-variants.ts`
- Modify: `frontend/src/components/ui/badge-variants.ts`
- Modify: `frontend/src/components/ui/table.tsx`
- Create: `frontend/src/components/stitch/StitchPageHeader.tsx`
- Create: `frontend/src/components/stitch/StitchPanel.tsx`

**Interfaces:**
- Produces: `StitchPageHeader(props: StitchPageHeaderProps): JSX.Element`
- Produces: `StitchPanel(props: StitchPanelProps): JSX.Element`
- Consumes: existing `cn()` from `frontend/src/lib/utils.ts`

- [x] **Step 1: Update global console tokens**

In `frontend/src/index.css`, align the existing token names with the Stitch project values while preserving existing Tailwind variable mappings:

```css
:root {
  color-scheme: dark;
  --radius: 0.5rem;

  --console-canvas: #0b1020;
  --console-surface: #0e1513;
  --console-surface-low: #161d1b;
  --console-surface-panel: #1a211f;
  --console-surface-high: #242b2a;
  --console-surface-highest: #2f3634;
  --console-input: #0f172a;
  --console-line: #263244;
  --console-ink: #e5e7eb;
  --console-ink-soft: #dde4e1;
  --console-muted: #94a3b8;
  --console-muted-strong: #bacac5;
  --operator-teal: #57f1db;
  --operator-teal-container: #2dd4bf;
  --healthy-green: #22c55e;
  --warning-amber: #f59e0b;
  --failure-red: #ef4444;

  --background: var(--console-surface);
  --foreground: var(--console-ink-soft);
  --card: var(--console-surface-low);
  --card-foreground: var(--console-ink-soft);
  --popover: var(--console-surface-high);
  --popover-foreground: var(--console-ink-soft);
  --primary: var(--operator-teal);
  --primary-foreground: #003731;
  --secondary: #404758;
  --secondary-foreground: #aeb5c9;
  --muted: var(--console-input);
  --muted-foreground: var(--console-muted);
  --accent: var(--operator-teal);
  --accent-foreground: #003731;
  --destructive: var(--failure-red);
  --border: var(--console-line);
  --input: var(--console-input);
  --ring: var(--operator-teal);
}
```

Keep the existing body background radial accent, but reduce it to a subtle operator wash:

```css
body {
  min-width: 320px;
  min-height: 100dvh;
  margin: 0;
  background:
    radial-gradient(circle at 0 0, rgba(87, 241, 219, 0.07), transparent 30rem),
    var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}
```

Add reusable operator classes:

```css
.operator-panel {
  border: 1px solid var(--console-line);
  background: var(--console-surface-low);
  border-radius: 0.75rem;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
}

.operator-panel-compact {
  border: 1px solid var(--console-line);
  background: var(--console-surface-low);
  border-radius: 0.5rem;
}

.status-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [x] **Step 2: Create `StitchPanel`**

Create `frontend/src/components/stitch/StitchPanel.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StitchPanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}

export function StitchPanel({ children, className, title, description, actions }: StitchPanelProps) {
  return (
    <section className={cn('operator-panel overflow-hidden', className)}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      {children}
    </section>
  );
}
```

- [x] **Step 3: Create `StitchPageHeader`**

Create `frontend/src/components/stitch/StitchPageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StitchPageHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly eyebrow?: string;
  readonly warning?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function StitchPageHeader({ title, description, eyebrow, warning, actions, className }: StitchPageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="font-mono text-xs uppercase tracking-widest text-[var(--operator-teal)]">{eyebrow}</p> : null}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {warning ? <div className="w-fit rounded-lg border border-border bg-[var(--console-surface-panel)] px-3 py-2 text-xs text-muted-foreground">{warning}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
```

- [x] **Step 4: Tune local UI primitives**

In `frontend/src/components/ui/table.tsx`, keep the component API unchanged and update only default class strings:

```tsx
className={cn('w-full caption-bottom text-sm', className)}
className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
className={cn('border-b border-border transition-colors hover:bg-[var(--console-surface-high)] data-[state=selected]:bg-[var(--console-surface-high)]', className)}
className={cn('h-10 px-3 text-left align-middle font-mono text-xs uppercase tracking-wider text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]', className)}
className={cn('px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]', className)}
```

In `frontend/src/components/ui/button-variants.ts`, keep variant names unchanged and tune the base to include `rounded-lg`, `active:scale-[0.96]`, and focus-visible ring styles already mapped to `--ring`.

In `frontend/src/components/ui/badge-variants.ts`, keep variant names unchanged and tune `default` to teal, `secondary` to surface-high, and `destructive` to failure red with readable text.

- [x] **Step 5: Validate Task 1**

Run: `npm --prefix frontend run build`

Expected: TypeScript and Vite build succeed.

Run: `npm --prefix frontend run lint`

Expected: oxlint reports no errors for the touched frontend files.

### Task 2: Rebuild The Shared Admin Shell Around The Stitch Navigation

**Files:**
- Modify: `frontend/src/types/admin.ts`
- Modify: `frontend/src/data/admin-static.ts`
- Modify: `frontend/src/components/stitch/StitchConsoleShell.tsx`
- Modify: `frontend/src/pages/AdminApp.tsx`
- Create: `frontend/src/pages/GatewayKeysView.tsx`
- Modify: `test/admin-frontend-helpers.test.ts`

**Interfaces:**
- Produces: `AdminViewId` includes `'gateway-keys'`
- Produces: `GatewayKeysView({ adminData }: GatewayKeysViewProps): JSX.Element`
- Produces: `StitchConsoleShell` accepts `topActions?: ReactNode` and `statusSummary?: ReactNode`

- [x] **Step 1: Add the new view id**

Modify `frontend/src/types/admin.ts`:

```ts
export type AdminViewId =
  | 'dashboard'
  | 'gateway-keys'
  | 'ai-providers'
  | 'auth-files'
  | 'available-models'
  | 'logs-viewer'
  | 'model-management';
```

- [ ] **Step 2: Update nav metadata**

Modify `frontend/src/data/admin-static.ts`:

```ts
import type { ComponentType } from 'react';
import { BarChart3, KeyRound, ListTree, Settings2, Shield, Terminal, type LucideProps } from 'lucide-react';
import type { AdminViewId } from '@/types/admin';

export interface AdminNavItem {
  readonly id: AdminViewId;
  readonly label: string;
  readonly description: string;
  readonly icon: ComponentType<LucideProps>;
}

export const adminNavItems: readonly AdminNavItem[] = [
  { id: 'dashboard', label: 'Bảng điều khiển', description: 'Runtime posture', icon: BarChart3 },
  { id: 'gateway-keys', label: 'Quản lý Key', description: 'Client to Gateway credentials', icon: KeyRound },
  { id: 'auth-files', label: 'Vertex Auth', description: 'Gateway to Google credentials', icon: Terminal },
  { id: 'logs-viewer', label: 'Nhật ký API', description: 'Telemetry beta', icon: ListTree },
  { id: 'ai-providers', label: 'Cấu hình', description: 'Routing and targets', icon: Settings2 },
  { id: 'model-management', label: 'Bảo mật', description: 'Model policy controls', icon: Shield },
  { id: 'available-models', label: 'Model Catalog', description: 'Read-only inventory', icon: ListTree },
];
```

Keep `securityNotices` unchanged unless copy is being localized in the same task.

- [ ] **Step 3: Add nav metadata regression test**

In `test/admin-frontend-helpers.test.ts`, import `adminNavItems` and add:

```ts
import { adminNavItems } from '../frontend/src/data/admin-static.js';

it('exposes a first-class gateway key admin view', () => {
  expect(adminNavItems.map((item) => item.id)).toContain('gateway-keys');
  expect(adminNavItems.find((item) => item.id === 'gateway-keys')?.label).toBe('Quản lý Key');
});
```

Run: `npm test -- test/admin-frontend-helpers.test.ts`

Expected before implementation: fails until `gateway-keys` exists.

- [ ] **Step 4: Rebuild `StitchConsoleShell`**

Modify `frontend/src/components/stitch/StitchConsoleShell.tsx` so it keeps the same `children`, `rail`, `activeView`, and `onViewChange` props, and adds optional top-bar actions:

```tsx
import type { ReactNode } from 'react';
import { Activity, Database, ExternalLink, LogOut } from 'lucide-react';
import { adminNavItems } from '@/data/admin-static';
import type { AdminViewId } from '@/types/admin';

export interface StitchConsoleShellProps {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly activeView?: AdminViewId;
  readonly onViewChange?: (view: AdminViewId) => void;
  readonly topActions?: ReactNode;
  readonly onLogout?: () => void;
}

export function StitchConsoleShell({ children, rail, activeView = 'dashboard', onViewChange, topActions, onLogout }: StitchConsoleShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-[var(--console-surface-low)] p-4 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
          <div className="mb-6 px-2">
            <a href="/admin" className="block text-2xl font-semibold tracking-tight text-[var(--operator-teal)]">
              Hệ thống Vertex
            </a>
            <p className="mt-1 text-xs text-muted-foreground">Môi trường Production</p>
          </div>
          <nav aria-label="Console navigation" className="grid gap-1 text-sm">
            {adminNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-all active:scale-[0.96] ${
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-[var(--console-surface-high)] hover:text-foreground'
                  }`}
                  onClick={() => onViewChange?.(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          {rail ? <div className="mt-6 hidden lg:block">{rail}</div> : null}
          {onLogout ? (
            <div className="mt-6 border-t border-border pt-4">
              <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[var(--failure-red)] hover:bg-[var(--console-surface-high)]" onClick={onLogout}>
                <LogOut className="h-5 w-5" aria-hidden />
                <span>Đăng xuất</span>
              </button>
            </div>
          ) : null}
        </aside>
        <section className="min-w-0 bg-[var(--console-surface)]">
          <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--console-surface)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-semibold tracking-tight text-[var(--operator-teal)]">Vertex Gateway</span>
              <span className="inline-flex items-center gap-2 rounded border border-border bg-[var(--console-surface-highest)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-foreground">
                <span className="status-dot bg-[var(--healthy-green)]" /> Production
              </span>
              <span className="inline-flex items-center gap-2 rounded border border-border bg-[var(--console-surface-highest)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <Database className="h-3.5 w-3.5 text-[var(--operator-teal)]" aria-hidden /> Admin Store
              </span>
            </div>
            <div className="flex items-center gap-2">
              <a className="hidden items-center gap-1 text-sm text-muted-foreground hover:text-[var(--operator-teal)] lg:inline-flex" href="/docs" target="_blank" rel="noreferrer">
                Tài liệu <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <Activity className="h-5 w-5 text-muted-foreground" aria-hidden />
              {topActions}
            </div>
          </header>
          <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 xl:p-6">{children}</div>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Add `GatewayKeysView`**

Create `frontend/src/pages/GatewayKeysView.tsx`:

```tsx
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface GatewayKeysViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function GatewayKeysView({ adminData }: GatewayKeysViewProps) {
  return (
    <div className="space-y-6">
      <StitchPageHeader
        eyebrow="Client -> Gateway"
        title="Quản lý Gateway Key"
        description="Gateway key dùng cho client gọi vào gateway. Đây không phải Google Cloud API key."
        actions={adminData.mutable ? <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} /> : null}
      />

      {adminData.error ? <AdminError message={adminData.error} onRetry={() => adminData.refetch()} /> : null}

      <StitchPanel title="Danh sách key" description="Key preview luôn được mask; thao tác thu hồi và xóa chỉ bật trong file-store mode.">
        {adminData.loading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : (
          <GatewayKeysTable
            rows={adminData.gatewayKeys}
            onRevoke={(id) => adminData.revokeKey(id)}
            onDelete={(id) => adminData.deleteKey(id)}
            mutable={adminData.mutable}
          />
        )}
      </StitchPanel>
    </div>
  );
}
```

- [ ] **Step 6: Wire the new route in `AdminApp`**

Modify imports in `frontend/src/pages/AdminApp.tsx`:

```tsx
import { GatewayKeysView } from '@/pages/GatewayKeysView';
```

Add the switch case:

```tsx
case 'gateway-keys':
  return <GatewayKeysView adminData={adminData} />;
```

Pass logout into the shell and remove the standalone logout block from page content:

```tsx
<StitchConsoleShell
  rail={<StitchSecurityRail notices={securityNotices} />}
  activeView={view}
  onViewChange={setView}
  onLogout={isAuthenticated ? () => { void handleLogout(); } : undefined}
>
```

Keep the login and forced password-change card inside `children` exactly as the auth gate.

- [ ] **Step 7: Validate Task 2**

Run: `npm test -- test/admin-frontend-helpers.test.ts`

Expected: nav helper test passes.

Run: `npm --prefix frontend run build`

Expected: TypeScript accepts the new view id and route switch.

### Task 3: Apply The Dashboard Overview Screen

**Files:**
- Modify: `frontend/src/components/stitch/StitchKpiStrip.tsx`
- Modify: `frontend/src/components/stitch/StitchSecurityRail.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `adminData.health`, `adminData.gatewayKeys`, `adminData.vertexTargets`, `adminData.loading`, `adminData.error`
- Produces: overview page matching `.stitch/designs/admin-dashboard.html`

- [ ] **Step 1: Tighten KPI tile styling**

Modify `frontend/src/components/stitch/StitchKpiStrip.tsx` so each metric card uses `operator-panel-compact`, mono labels, and compact numeric values:

```tsx
className="operator-panel-compact relative flex min-h-28 flex-col justify-between overflow-hidden p-4"
className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
className="font-mono text-2xl font-semibold tabular-nums text-foreground"
```

Keep the existing `KpiMetric` interface.

- [ ] **Step 2: Redesign security rail**

Modify `frontend/src/components/stitch/StitchSecurityRail.tsx` wrapper and title:

```tsx
<div className="operator-panel p-4">
  <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
    <ShieldAlert className="h-5 w-5 text-[var(--operator-teal)]" aria-hidden /> Bảo mật
  </h2>
```

Keep the existing `SecurityNotice` interface and color mapping.

- [ ] **Step 3: Recompose `Dashboard`**

In `frontend/src/pages/Dashboard.tsx`, derive KPI metrics from live data:

```tsx
const activeGatewayKeys = adminData.gatewayKeys.filter((key) => key.status === 'active').length;
const readyTargets = adminData.vertexTargets.filter((target) => target.health === 'ready').length;
const failedTargets = adminData.vertexTargets.filter((target) => target.health === 'failed').length;
const metrics = [
  { id: 'gateway-keys', label: 'Active Gateway Keys', value: String(activeGatewayKeys), icon: 'key', colorScheme: 'primary' as const },
  { id: 'vertex-targets', label: 'Vertex Targets', value: String(adminData.vertexTargets.length), icon: 'dns', colorScheme: 'secondary' as const },
  { id: 'ready-targets', label: 'Ready Targets', value: String(readyTargets), trendValue: failedTargets ? `${failedTargets} failed` : 'ready', colorScheme: failedTargets ? 'error' as const : 'tertiary' as const },
  { id: 'runtime-mode', label: 'Runtime Mode', value: adminData.health?.runtimeMode ?? 'unknown', colorScheme: 'secondary' as const },
];
```

Recompose the JSX around:

```tsx
<StitchPageHeader ... />
<StitchKpiStrip metrics={metrics} />
<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
  <div className="space-y-6">
    <StitchPanel title="Nhật ký API gần đây" ...><ApiLogsTable rows={apiLogs} /></StitchPanel>
    <StitchPanel title="Gateway Keys" ...>...</StitchPanel>
    <StitchPanel title="Vertex Targets" ...>...</StitchPanel>
  </div>
  <aside className="space-y-6">
    <StitchSecurityRail notices={...} />
  </aside>
</div>
```

Use `TableSkeleton` for live-backed key/target sections while loading. Keep the mock `apiLogs` beta label visible because live logs are not implemented.

- [ ] **Step 4: Validate Task 3**

Run: `npm --prefix frontend run build`

Expected: dashboard compiles and the `KpiMetric` array type checks.

### Task 4: Apply Gateway Key And Vertex Auth Table Treatments

**Files:**
- Modify: `frontend/src/components/console/GatewayKeysTable.tsx`
- Modify: `frontend/src/components/console/VertexTargetsTable.tsx`
- Modify: `frontend/src/pages/AuthFilesView.tsx`
- Modify: `frontend/src/pages/AIProvidersView.tsx`

**Interfaces:**
- Consumes: existing table props and mutation callbacks unchanged
- Produces: redesigned key and target tables without backend API changes

- [ ] **Step 1: Update `GatewayKeysTable` status styling**

Replace `getStatusColor` in `frontend/src/components/console/GatewayKeysTable.tsx`:

```tsx
const getStatusColor = (status: string) => {
  if (status === 'active') return 'border border-[var(--healthy-green)]/30 bg-[var(--healthy-green)]/15 text-[var(--healthy-green)]';
  if (status === 'revoked') return 'border border-[var(--failure-red)]/30 bg-[var(--failure-red)]/15 text-[var(--failure-red)]';
  return 'border border-border bg-secondary text-secondary-foreground';
};
```

Wrap the table in `operator-panel-compact overflow-hidden` instead of `rounded-md border`. Change preview and dates to `font-mono text-sm text-[var(--operator-teal)]` and `font-mono text-xs text-muted-foreground`.

- [ ] **Step 2: Convert key actions to compact icon+text buttons**

Keep current copy/copy-failed state behavior. Change action wrapper to:

```tsx
<div className="flex flex-wrap justify-end gap-1">
```

Use `variant="ghost" size="sm"` for copy, revoke, and delete. Keep destructive text on revoke/delete.

- [ ] **Step 3: Update `VertexTargetsTable` health styling**

Replace `getHealthColor` in `frontend/src/components/console/VertexTargetsTable.tsx`:

```tsx
const getHealthColor = (health: string) => {
  if (health === 'ready') return 'border border-[var(--healthy-green)]/30 bg-[var(--healthy-green)]/15 text-[var(--healthy-green)]';
  if (health === 'degraded') return 'border border-[var(--warning-amber)]/30 bg-[var(--warning-amber)]/15 text-[var(--warning-amber)]';
  if (health === 'failed') return 'border border-[var(--failure-red)]/30 bg-[var(--failure-red)]/15 text-[var(--failure-red)]';
  if (health === 'disabled') return 'border border-border bg-secondary text-secondary-foreground';
  return 'border border-border bg-muted text-muted-foreground';
};
```

Apply mono classes to project id, location, mode, and health detail lines.

- [ ] **Step 4: Recompose `AuthFilesView` with Stitch header and panel**

Use `StitchPageHeader` with:

```tsx
title="Cấu hình Vertex AI"
description="Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client."
eyebrow="Gateway -> Google"
warning={<span>Service account private key không bao giờ được hiển thị trong UI.</span>}
```

Wrap the `VertexTargetsTable` in `StitchPanel` titled `Danh sách Service Account`.

- [ ] **Step 5: Recompose `AIProvidersView` as routing configuration**

Keep the current runtime selection and mutation handlers. Replace the page header section with `StitchPageHeader` titled `Cấu hình Routing`, description `Điều phối Agent Platform API key targets, selection mode, và health probes.` Use `StitchPanel` for Gateway Keys and Agent Platform targets.

- [ ] **Step 6: Validate Task 4**

Run: `npm --prefix frontend run build`

Expected: table components compile with unchanged prop contracts.

Run: `npm test -- test/admin-frontend-helpers.test.ts`

Expected: no frontend helper regressions.

### Task 5: Apply Logs, Model Catalog, And Form Screen Polish

**Files:**
- Modify: `frontend/src/components/console/ApiLogsTable.tsx`
- Modify: `frontend/src/components/console/AdminState.tsx`
- Modify: `frontend/src/components/console/ModelCatalogEditor.tsx`
- Modify: `frontend/src/pages/LogsViewerView.tsx`
- Modify: `frontend/src/pages/AvailableModelsView.tsx`
- Modify: `frontend/src/pages/ModelManagementView.tsx`

**Interfaces:**
- Consumes: existing filter/sort hooks unchanged
- Produces: consistent redesigned logs, catalog, loading, empty, beta, and error states

- [ ] **Step 1: Redesign `ApiLogsTable` filter panel**

In `frontend/src/components/console/ApiLogsTable.tsx`, keep `useLogTable(rows)` unchanged. Replace the outer section with:

```tsx
<section className="operator-panel overflow-hidden">
```

Change the header area to use a five-column responsive grid like the Stitch logs screen:

```tsx
<div className="grid gap-3 border-b border-border p-4 md:grid-cols-5">
```

Keep route-family select, status select, and model input. Add two disabled controls for visual parity with the Stitch design while clearly marking beta status:

```tsx
<Input aria-label="Khoảng thời gian" value="1 giờ qua" disabled />
<Input aria-label="Search logs" value="" placeholder="request id, key alias" disabled />
```

- [ ] **Step 2: Apply mono table cells for logs**

Keep current columns and sorting. Ensure time, model, latency, status, gateway key, and upstream target cells use `font-mono` and `tabular-nums` classes.

- [ ] **Step 3: Redesign `LogsViewerView`**

Use `StitchPageHeader`:

```tsx
title="Nhật ký API"
description="Theo dõi yêu cầu API, route family, model, latency, status, gateway key alias và upstream target."
warning={<span>Beta: dữ liệu hiện là mock data cho đến khi streaming log API được triển khai.</span>}
```

Keep `BetaState` but move it below the page header and above `ApiLogsTable`.

- [ ] **Step 4: Align admin states**

In `frontend/src/components/console/AdminState.tsx`, keep exported component names unchanged. Tune wrappers to `operator-panel-compact` or `operator-panel`, use no spinner, keep skeleton rows, and make error blocks use failure red border plus concrete retry button styling.

- [ ] **Step 5: Align model catalog pages**

In `AvailableModelsView`, replace the current card header with `StitchPageHeader` and wrap the table in `StitchPanel` titled `Model catalog`.

In `ModelManagementView`, replace the current card header with `StitchPageHeader` and wrap provider editors in a grid:

```tsx
<div className="grid gap-4 xl:grid-cols-2">
```

In `ModelCatalogEditor`, replace outer `rounded-md border border-border bg-card p-4` with `operator-panel-compact p-4`, and ensure labels/helper text remain above inputs.

- [ ] **Step 6: Validate Task 5**

Run: `npm --prefix frontend run build`

Expected: logs and model pages compile.

Run: `npm --prefix frontend run lint`

Expected: oxlint reports no errors.

### Task 6: Responsive And Visual Verification

**Files:**
- Modify only files touched by Tasks 1-5 if validation reveals overflow, inaccessible focus, or layout regressions.

**Interfaces:**
- Consumes: built Vite frontend
- Produces: verified admin UI across desktop and mobile widths

- [ ] **Step 1: Build the frontend**

Run: `npm --prefix frontend run build`

Expected: `frontend/dist/index.html` and `/admin/assets/*` assets build successfully.

- [ ] **Step 2: Compile the full project**

Run: `npm run compile`

Expected: backend TypeScript compile and frontend build succeed. This command also runs `npm --prefix frontend ci`, so it is slower but validates the production compile path.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- test/admin-frontend-helpers.test.ts test/admin-routes.test.ts test/admin-ui.test.ts`

Expected: admin helper and route tests pass.

- [ ] **Step 4: Run local frontend preview for screenshots**

Run: `npm --prefix frontend run preview -- --host 127.0.0.1 --port 4173`

Expected: Vite preview serves the frontend. Open `http://127.0.0.1:4173/admin` if the preview uses the `/admin/` base path, otherwise `http://127.0.0.1:4173/`.

- [ ] **Step 5: Capture responsive checkpoints**

Use Playwright/browser checks at widths `375`, `768`, `1280`, and `1440` for these views:

- `?view=dashboard`
- `?view=gateway-keys`
- `?view=auth-files`
- `?view=logs-viewer`
- `?view=ai-providers`

For each viewport, verify:

- No horizontal overflow outside intentional table scroll containers.
- Sidebar collapses or stacks without hiding labels on narrow screens.
- Top bar content wraps without overlapping.
- Table cells remain readable and masked secrets are not revealed.
- Focus rings are visible on nav, buttons, inputs, and selects.

- [ ] **Step 6: Final safety scan**

Search touched files for accidental secret display or absolute credential paths:

Run: `rg "private_key|credentialsFile|apiKey|secret|preview" frontend/src src/admin test`

Expected: no newly introduced full secret rendering. Existing secret-related code should still mask previews and use explicit create/copy flows.

## Self-Review

- Spec coverage: the plan maps all four redesigned Stitch screens to live frontend pages, adds the missing first-class Gateway Keys route, and keeps the model/catalog pages stylistically aligned even though they were not separate Stitch screens.
- Placeholder scan: no task uses TBD/TODO/fill-in placeholders; each task names exact files, expected interfaces, commands, and validation results.
- Type consistency: new `AdminViewId` value is wired through `adminNavItems`, `useAdminView`, `StitchConsoleShell`, and `AdminApp`; table component prop contracts remain unchanged.
- Scope control: backend APIs, admin auth/session behavior, Docker packaging, and live telemetry implementation are intentionally out of scope for this frontend redesign plan.
