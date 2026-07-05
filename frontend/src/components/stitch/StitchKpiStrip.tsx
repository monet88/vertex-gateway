import type { ComponentType } from 'react';
import { Key, Minus, Server, TrendingDown, TrendingUp, type LucideProps } from 'lucide-react';

export interface KpiMetric {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly icon?: string;
  readonly trendIcon?: string;
  readonly trendValue?: string;
  readonly colorScheme: 'primary' | 'error' | 'secondary' | 'tertiary';
}

export interface StitchKpiStripProps {
  readonly metrics: ReadonlyArray<KpiMetric>;
}

const iconByName: Record<string, ComponentType<LucideProps>> = {
  trending_up: TrendingUp,
  trending_down: TrendingDown,
  trending_flat: Minus,
  key: Key,
  dns: Server,
};

const accentByScheme: Record<KpiMetric['colorScheme'], { gradient: string; text: string }> = {
  primary: { gradient: 'via-[var(--operator-teal)]/20', text: 'text-[var(--operator-teal)]' },
  error: { gradient: 'via-[var(--failure-red)]/20', text: 'text-[var(--failure-red)]' },
  secondary: { gradient: 'via-[var(--console-muted)]/20', text: 'text-[var(--console-muted)]' },
  tertiary: { gradient: 'via-[var(--healthy-green)]/20', text: 'text-[var(--healthy-green)]' },
};

export function StitchKpiStrip({ metrics }: StitchKpiStripProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const accent = accentByScheme[metric.colorScheme];
        const iconName = metric.trendIcon ?? metric.icon;
        const Icon = iconName ? iconByName[iconName] : undefined;

        return (
          <div
            key={metric.id}
            className="relative flex flex-col gap-2 overflow-hidden rounded-xl bg-[var(--console-surface)] p-4 shadow-lg"
          >
            <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${accent.gradient} to-transparent`} />
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--console-muted)]">{metric.label}</span>
            <div className="flex items-end justify-between">
              <span className="font-mono text-2xl tabular-nums text-[var(--console-ink)]">{metric.value}</span>
              {(metric.trendValue || Icon) && (
                <div className={`flex items-center gap-1 ${accent.text}`}>
                  {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
                  {metric.trendValue && <span className="font-mono text-sm">{metric.trendValue}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
