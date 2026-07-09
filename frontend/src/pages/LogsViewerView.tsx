import { useMemo, useState } from 'react';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { AdminError } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { Button } from '@/components/ui/button';
import { useApiLogs } from '@/hooks/useApiLogs';
import { mapApiCallLogEntryToRow } from '@/lib/admin-dashboard-api';

interface LogsViewerViewProps {
  readonly token: string;
  readonly enabled: boolean;
}

export function LogsViewerView({ token, enabled }: LogsViewerViewProps) {
  const [showRaw, setShowRaw] = useState(false);
  const logs = useApiLogs(token, enabled, { limit: 200 });
  const rows = useMemo(() => logs.entries.map(mapApiCallLogEntryToRow), [logs.entries]);

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Nhật ký API"
        description="Theo dõi yêu cầu API, route family, model, latency, status, gateway key alias và upstream target."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => { void logs.refresh(); }} disabled={logs.loading}>
              Refresh
            </Button>
            <Button
              variant={logs.autoRefresh ? 'default' : 'secondary'}
              onClick={() => logs.setAutoRefresh((value) => !value)}
              aria-pressed={logs.autoRefresh}
            >
              Auto Refresh {logs.autoRefresh ? 'ON' : 'OFF'}
            </Button>
            <Button
              variant={showRaw ? 'default' : 'secondary'}
              onClick={() => setShowRaw((value) => !value)}
              aria-pressed={showRaw}
            >
              Show Raw Logs
            </Button>
            <Button
              variant="destructive"
              onClick={() => { void logs.clear().catch(() => {}); }}
              disabled={logs.loading}
            >
              Clear
            </Button>
          </div>
        }
      />

      {logs.error && <AdminError message={logs.error} onRetry={() => { void logs.refresh(); }} />}

      {showRaw ? (
        <section className="operator-panel overflow-hidden">
          <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-6 text-muted-foreground">
            {logs.entries.length === 0
              ? 'Chưa có API call nào được ghi.'
              : logs.entries.map((entry) => (
                `${entry.timestamp} ${entry.statusClass} ${entry.method} ${entry.path} ${entry.latencyMs}ms ${entry.operation}`
              )).join('\n')}
          </pre>
        </section>
      ) : (
        <ApiLogsTable rows={rows} />
      )}
    </div>
  );
}
