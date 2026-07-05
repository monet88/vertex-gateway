import type { ComponentType } from 'react';
import { AlertCircle, Info, Lock, ShieldAlert, type LucideProps } from 'lucide-react';

export interface SecurityNotice {
  readonly id: string;
  readonly message: string;
  readonly type: 'info' | 'error' | 'warning';
  readonly icon: string;
}

export interface StitchSecurityRailProps {
  readonly notices: ReadonlyArray<SecurityNotice>;
}

const iconByName: Record<string, ComponentType<LucideProps>> = {
  info: Info,
  error: AlertCircle,
  lock: Lock,
};

const iconColorByType: Record<SecurityNotice['type'], string> = {
  info: 'text-[var(--operator-teal)]',
  error: 'text-[var(--failure-red)]',
  warning: 'text-[var(--warning-amber)]',
};

export function StitchSecurityRail({ notices }: StitchSecurityRailProps) {
  return (
    <div className="relative rounded-xl bg-[var(--console-surface)] p-6 shadow-lg">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--console-ink)]">
        <ShieldAlert className="h-5 w-5 text-[var(--console-muted)]" aria-hidden /> Security notices
      </h2>
      <ul className="flex flex-col gap-3 text-sm text-[var(--console-muted)]">
        {notices.map((notice) => {
          const Icon = iconByName[notice.icon] ?? Info;

          return (
            <li key={notice.id} className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-[18px] w-[18px] ${iconColorByType[notice.type]}`} aria-hidden />
              <span className={notice.type === 'error' ? 'text-[var(--console-ink)]' : ''}>{notice.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
