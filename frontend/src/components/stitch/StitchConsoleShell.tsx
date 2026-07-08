import type { ReactNode } from 'react';
import { adminNavItems } from '@/data/admin-static';
import type { AdminViewId } from '@/types/admin';

export interface StitchConsoleShellProps {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly activeView?: AdminViewId;
  readonly onViewChange?: (view: AdminViewId) => void;
}

export function StitchConsoleShell({ children, rail, activeView = 'dashboard', onViewChange }: StitchConsoleShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-border bg-card/90 p-4 lg:border-b-0 lg:border-r">
          <a href="/admin" className="block rounded-lg text-lg font-semibold tracking-tight text-foreground">
            Vertex Gateway Admin
          </a>
          <nav aria-label="Console navigation" className="mt-8 grid gap-2 text-sm text-muted-foreground">
            {adminNavItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                  activeView === item.id
                    ? 'bg-secondary text-foreground'
                    : 'hover:bg-secondary hover:text-foreground'
                }`}
                onClick={() => onViewChange?.(item.id)}
                aria-current={activeView === item.id ? 'page' : undefined}
              >
                {item.label}
              </button>
            ))}
          </nav>
          {rail ? <div className="mt-6">{rail}</div> : null}
        </aside>
        <section className="p-4 xl:p-6">
          <div className="min-w-0 space-y-4">{children}</div>
        </section>
      </div>
    </main>
  );
}
