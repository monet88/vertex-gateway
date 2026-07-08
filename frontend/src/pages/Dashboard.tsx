import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { Button } from '@/components/ui/button';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchKpiStrip } from '@/components/stitch/StitchKpiStrip';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import { apiLogs } from '@/data/mockData';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface DashboardProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function Dashboard({ adminData }: DashboardProps) {
  const activeGatewayKeys = adminData.gatewayKeys.filter((key) => key.status === 'active').length;
  const apiKeyTargets = adminData.vertexTargets.filter((target) => target.hasApiKey);
  const readyApiKeyTargets = apiKeyTargets.filter((target) => target.health === 'ready').length;
  const failedApiKeyTargets = apiKeyTargets.filter((target) => target.health === 'failed').length;
  const metrics = [
    { id: 'gateway-keys', label: 'Active Gateway Keys', value: String(activeGatewayKeys), icon: 'key', colorScheme: 'primary' as const },
    { id: 'agent-platform-apikey', label: 'Agent Platform Apikey', value: String(apiKeyTargets.length), icon: 'dns', colorScheme: 'secondary' as const },
    { id: 'ready-apikey-targets', label: 'Ready Apikey', value: String(readyApiKeyTargets), trendValue: failedApiKeyTargets ? `${failedApiKeyTargets} failed` : 'ready', colorScheme: failedApiKeyTargets ? 'error' as const : 'tertiary' as const },
    { id: 'runtime-mode', label: 'Runtime Mode', value: adminData.health?.runtimeMode ?? 'unknown', colorScheme: 'secondary' as const },
  ];

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Bảng điều khiển Admin"
        description="Runtime posture, gateway keys, and Agent Platform Apikey overview."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {adminData.mutable && (
              <>
                <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} />
                <VertexTargetDialog onCreate={(draft) => adminData.addTarget(draft)} />
                <ServiceAccountTargetDialog onCreate={(draft) => adminData.importTarget(draft)} />
              </>
            )}
            <Button variant="secondary" onClick={() => adminData.reload()}>Reload Runtime</Button>
          </div>
        }
      />

      {adminData.error && <AdminError message={adminData.error} onRetry={() => adminData.refetch()} />}

      <StitchKpiStrip metrics={metrics} />

      <div className="space-y-6">
        <StitchPanel title="Nhật ký API gần đây" description="Beta — mock data">
          <ApiLogsTable rows={apiLogs} />
        </StitchPanel>

        <StitchPanel title="Gateway Keys">
          {adminData.loading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} onDelete={(id) => adminData.deleteKey(id)} mutable={adminData.mutable} />
          )}
        </StitchPanel>

        <StitchPanel title="Agent Platform Apikey">
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
