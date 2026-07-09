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
