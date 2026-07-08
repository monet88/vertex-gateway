import type { RuntimeHealthSummary } from '@/types/admin';

export interface ShellRuntimeBadge {
  readonly label: string;
  readonly toneClass: string;
}

export const getShellRuntimeBadge = (health: RuntimeHealthSummary | null): ShellRuntimeBadge => {
  if (!health) {
    return { label: 'Health Unknown', toneClass: 'bg-[var(--warning-amber)]' };
  }

  if (!health.ok) {
    return { label: 'Runtime Failed', toneClass: 'bg-[var(--failure-red)]' };
  }

  if (health.degradedTargets > 0 || health.healthyTargets < health.targetCount) {
    return { label: 'Runtime Degraded', toneClass: 'bg-[var(--warning-amber)]' };
  }

  return { label: 'Runtime Ready', toneClass: 'bg-[var(--healthy-green)]' };
};