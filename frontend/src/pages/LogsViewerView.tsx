import { BetaState } from '@/components/console/AdminState';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { apiLogs } from '@/data/mockData';

export function LogsViewerView() {
  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Logs Viewer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Telemetry beta — view-only mock data while the streaming log API is under development.</p>
      </section>
      <BetaState title="Beta Feature" body="Logs are currently populated with mock data. Live streaming will be added in a future release." />
      <ApiLogsTable rows={apiLogs} />
    </div>
  );
}
