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
    <div className="bg-surface-container dark:bg-surface-container rounded-xl p-6 shadow-lg relative">
      <h2 className="font-headline-sm text-lg text-on-surface flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-secondary-container">security</span> Security notices
      </h2>
      <ul className="flex flex-col gap-3 font-body-md text-sm text-on-surface-variant">
        {notices.map((notice) => {
          let iconColorClass = 'text-primary-container';
          if (notice.type === 'error') iconColorClass = 'text-error';
          if (notice.type === 'warning') iconColorClass = 'text-outline';
          
          return (
            <li key={notice.id} className="flex items-start gap-2">
              <span className={`material-symbols-outlined text-[18px] ${iconColorClass} mt-0.5`}>{notice.icon}</span>
              <span className={notice.type === 'error' ? 'text-on-surface' : ''}>{notice.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
