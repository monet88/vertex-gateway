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
import { StitchSecurityRail } from '@/components/stitch/StitchSecurityRail';
import { securityNotices as adminSecurityNotices } from '@/data/admin-static';
import { apiLogs } from '@/data/mockData';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

const securityNotices = adminSecurityNotices.map((message, index) => ({
  id: `notice-${index}`,
  message,
  type: 'info' as const,
  icon: 'info',
}));

interface DashboardProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function Dashboard({ adminData }: DashboardProps) {
  const activeGatewayKeys = adminData.gatewayKeys.filter((key) => key.status === 'active').length;
  const readyTargets = adminData.vertexTargets.filter((target) => target.health === 'ready').length;
  const failedTargets = adminData.vertexTargets.filter((target) => target.health === 'failed').length;
  const metrics = [
    { id: 'gateway-keys', label: 'Active Gateway Keys', value: String(activeGatewayKeys), icon: 'key', colorScheme: 'primary' as const },
    { id: 'vertex-targets', label: 'Vertex Targets', value: String(adminData.vertexTargets.length), icon: 'dns', colorScheme: 'secondary' as const },
    { id: 'ready-targets', label: 'Ready Targets', value: String(readyTargets), trendValue: failedTargets ? `${failedTargets} failed` : 'ready', colorScheme: failedTargets ? 'error' as const : 'tertiary' as const },
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
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

          <StitchPanel title="Vertex Targets">
            {adminData.loading ? (
              <TableSkeleton rows={3} columns={6} />
            ) : (
              <VertexTargetsTable rows={adminData.vertexTargets} />
            )}
          </StitchPanel>
        </div>
        <aside className="space-y-6">
          <StitchSecurityRail notices={securityNotices} />
        </aside>
      </div>
    </div>
  );
}
