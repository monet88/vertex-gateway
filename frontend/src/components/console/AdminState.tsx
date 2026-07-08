import { Button } from '@/components/ui/button';

export function AdminError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <div className="operator-panel-compact border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <p>{message}</p>
      {onRetry ? <Button className="mt-3" variant="secondary" size="sm" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="operator-panel-compact border-dashed border-border bg-muted/40 p-4 text-sm">
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

export function BetaState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="operator-panel-compact border-[var(--warning-amber)]/40 bg-[var(--warning-amber)]/10 p-4 text-sm">
      <h3 className="font-medium text-foreground">{title}</h3>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

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
