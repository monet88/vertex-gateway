import type { ReactNode } from 'react';
import { Activity, Database, ExternalLink, LogOut } from 'lucide-react';
import { adminNavItems } from '@/data/admin-static';
import { getShellRuntimeBadge } from '@/components/stitch/shell-runtime-badge';
import type { AdminViewId, RuntimeHealthSummary } from '@/types/admin';

export interface StitchConsoleShellProps {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly activeView?: AdminViewId;
  readonly onViewChange?: (view: AdminViewId) => void;
  readonly topActions?: ReactNode;
  readonly onLogout?: () => void;
  readonly health?: RuntimeHealthSummary | null;
  readonly gateEnabled?: boolean;
}

export function StitchConsoleShell({
  children,
  rail,
  activeView = 'dashboard',
  onViewChange,
  topActions,
  onLogout,
  health = null,
  gateEnabled = false,
}: StitchConsoleShellProps) {
  const runtimeBadge = getShellRuntimeBadge(health);
  const runtimeModeLabel = `Runtime ${health?.runtimeMode ?? 'unknown'}`;
  const visibleNav = adminNavItems.filter((item) => item.id !== 'logs-viewer' || gateEnabled);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="border-b border-border bg-[var(--console-surface-low)] p-4 md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
          <div className="mb-6 px-2">
            <a href="/admin" className="block text-2xl font-semibold tracking-tight text-[var(--operator-teal)]">
              Hệ thống Vertex
            </a>
            <p className="mt-1 text-xs text-muted-foreground">{runtimeModeLabel}</p>
          </div>
          <nav aria-label="Console navigation" className="grid gap-1 text-sm">
            {visibleNav.map((item) => {
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
          {rail ? <div className="mt-6">{rail}</div> : null}
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
                <span className={`status-dot ${runtimeBadge.toneClass}`} /> {runtimeBadge.label}
              </span>
              <span className="inline-flex items-center gap-2 rounded border border-border bg-[var(--console-surface-highest)] px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                <Database className="h-3.5 w-3.5 text-[var(--operator-teal)]" aria-hidden /> Admin Store: {health?.mode ?? 'unknown'}
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
