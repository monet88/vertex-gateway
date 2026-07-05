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

export function StitchKpiStrip({ metrics }: StitchKpiStripProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {metrics.map((metric) => {
        let gradientClass = '';
        let trendColorClass = '';
        if (metric.colorScheme === 'primary') {
          gradientClass = 'via-[var(--operator-teal)]/20';
          trendColorClass = 'text-[var(--operator-teal)]';
        } else if (metric.colorScheme === 'error') {
          gradientClass = 'via-[var(--failure-red)]/20';
          trendColorClass = 'text-[var(--failure-red)]';
        } else if (metric.colorScheme === 'secondary') {
          gradientClass = 'via-[var(--console-muted)]/20';
          trendColorClass = 'text-[var(--console-muted)]';
        } else if (metric.colorScheme === 'tertiary') {
          gradientClass = 'via-[var(--healthy-green)]/20';
          trendColorClass = 'text-[var(--healthy-green)]';
        }

        return (
          <div key={metric.id} className="bg-[var(--console-surface)] rounded-xl p-md flex flex-col gap-sm relative overflow-hidden shadow-lg">
            <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${gradientClass} to-transparent`}></div>
            <span className="font-label-caps text-xs text-[var(--console-muted)] uppercase">{metric.label}</span>
            <div className="flex items-end justify-between">
              <span className="font-headline-md text-2xl text-[var(--console-ink)] font-code-table tabular-nums">{metric.value}</span>
              {(metric.trendValue || metric.icon) && (
                <div className={`flex items-center gap-1 ${trendColorClass}`}>
                  <span className="material-symbols-outlined text-[16px]">{metric.trendIcon || metric.icon}</span>
                  {metric.trendValue && <span className="font-code-table text-sm">{metric.trendValue}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
