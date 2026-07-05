export interface SecurityNotice {
  readonly id: string;
  readonly message: string;
  readonly type: 'info' | 'error' | 'warning';
  readonly icon: string;
}

export interface StitchSecurityRailProps {
  readonly notices: ReadonlyArray<SecurityNotice>;
}

export function StitchSecurityRail({ notices }: StitchSecurityRailProps) {
  return (
    <div className="bg-[var(--console-surface)] rounded-xl p-lg shadow-lg relative">
      <h2 className="font-headline-sm text-lg text-[var(--console-ink)] flex items-center gap-2 mb-md">
        <span className="material-symbols-outlined text-[var(--console-muted)]">security</span> Security notices
      </h2>
      <ul className="flex flex-col gap-3 font-body-md text-sm text-[var(--console-muted)]">
        {notices.map((notice) => {
          let iconColorClass = 'text-[var(--operator-teal)]';
          if (notice.type === 'error') iconColorClass = 'text-[var(--failure-red)]';
          if (notice.type === 'warning') iconColorClass = 'text-[var(--warning-amber)]';
          
          return (
            <li key={notice.id} className="flex items-start gap-2">
              <span className={`material-symbols-outlined text-[18px] ${iconColorClass} mt-0.5`}>{notice.icon}</span>
              <span className={notice.type === 'error' ? 'text-[var(--console-ink)]' : ''}>{notice.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
