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
      <Badge variant="secondary">{health.selection}</Badge>
      <Badge variant="secondary">{health.mode}</Badge>
      <Badge variant={health.degradedTargets > 0 ? 'destructive' : 'secondary'}>{targetLabel}</Badge>
    </div>
  );
}
