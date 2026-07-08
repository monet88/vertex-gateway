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
