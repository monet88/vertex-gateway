import { useMemo } from 'react';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { Button } from '@/components/ui/button';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchKpiStrip } from '@/components/stitch/StitchKpiStrip';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import { useApiLogs } from '@/hooks/useApiLogs';
import { mapApiCallLogEntryToRow } from '@/lib/admin-dashboard-api';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import type { AdminViewId } from '@/types/admin';

interface DashboardProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
  readonly gateEnabled: boolean;
  readonly onNavigate?: (view: AdminViewId) => void;
}

export function Dashboard({ adminData, token, gateEnabled, onNavigate }: DashboardProps) {
  const logs = useApiLogs(token, gateEnabled, { limit: 5 });
  const previewRows = useMemo(() => logs.entries.map(mapApiCallLogEntryToRow), [logs.entries]);
  const activeGatewayKeys = adminData.gatewayKeys.filter((key) => key.status === 'active').length;
  const apiKeyTargets = adminData.vertexTargets.filter((target) => target.hasApiKey);
  const readyApiKeyTargets = apiKeyTargets.filter((target) => target.health === 'ready').length;
  const failedApiKeyTargets = apiKeyTargets.filter((target) => target.health === 'failed').length;
  const metrics = [
    { id: 'gateway-keys', label: 'Active Gateway Keys', value: String(activeGatewayKeys), icon: 'key', colorScheme: 'primary' as const },
    { id: 'agent-platform-api-key', label: 'Agent Platform API key', value: String(apiKeyTargets.length), icon: 'dns', colorScheme: 'secondary' as const },
    { id: 'ready-api-key-targets', label: 'Ready API key targets', value: String(readyApiKeyTargets), trendValue: failedApiKeyTargets ? `${failedApiKeyTargets} failed` : 'ready', colorScheme: failedApiKeyTargets ? 'error' as const : 'tertiary' as const },
    { id: 'runtime-mode', label: 'Runtime Mode', value: adminData.health?.runtimeMode ?? 'unknown', colorScheme: 'secondary' as const },
  ];

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Bảng điều khiển Admin"
        description="Runtime posture, gateway keys, and Agent Platform API key overview."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {adminData.mutable && (
              <>
                <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} />
                <VertexTargetDialog onCreate={(draft) => adminData.addTarget(draft)} />
              </>
            )}
            <Button variant="secondary" onClick={() => { void adminData.reload().catch(() => {}); }}>Reload Runtime</Button>
          </div>
        }
      />

      {adminData.error && <AdminError message={adminData.error} onRetry={() => adminData.refetch()} />}

      <StitchKpiStrip metrics={metrics} />

      <div className="space-y-6">
        {gateEnabled ? (
          <StitchPanel
            title="Nhật ký API gần đây"
            description="Live"
            actions={
              <Button variant="secondary" onClick={() => onNavigate?.('logs-viewer')}>
                Xem tất cả
              </Button>
            }
          >
            {logs.loading && previewRows.length === 0 ? (
              <TableSkeleton rows={3} columns={5} />
            ) : (
              <ApiLogsTable rows={previewRows} standalone={false} />
            )}
          </StitchPanel>
        ) : (
          <StitchPanel title="Nhật ký API gần đây" description="Diagnostics đang tắt">
            <p className="p-4 text-sm text-muted-foreground">
              Bật Debug Mode và Log to File trong Cấu hình để ghi và xem Nhật ký API.
            </p>
          </StitchPanel>
        )}

        <StitchPanel title="Gateway Keys">
          {adminData.loading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} onDelete={(id) => adminData.deleteKey(id)} mutable={adminData.mutable} />
          )}
        </StitchPanel>

        <StitchPanel title="Agent Platform API key">
          {adminData.loading ? (
            <TableSkeleton rows={3} columns={6} />
          ) : (
            <VertexTargetsTable rows={apiKeyTargets} />
          )}
        </StitchPanel>
      </div>
    </div>
  );
}
