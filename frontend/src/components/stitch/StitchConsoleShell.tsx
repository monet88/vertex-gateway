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
