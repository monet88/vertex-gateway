import { RuntimeBadges } from '@/components/console/RuntimeBadges';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { Button } from '@/components/ui/button';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { apiLogs } from '@/data/mockData';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface DashboardProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function Dashboard({ adminData }: DashboardProps) {
  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vertex Gateway Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">Runtime posture, gateway keys, and Vertex targets overview.</p>
          <RuntimeBadges health={adminData.health ?? null} />
        </div>
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
      </section>

      {adminData.error && <AdminError message={adminData.error} onRetry={() => adminData.refetch()} />}

      <section id="keys" className="scroll-mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Gateway keys</h2>
          {adminData.loading && <span className="text-sm text-muted-foreground">Đang tải dữ liệu admin…</span>}
        </div>
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : (
          <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} mutable={adminData.mutable} />
        )}
      </section>

      <section id="targets" className="scroll-mt-6">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Vertex targets</h2>
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : (
          <VertexTargetsTable rows={adminData.vertexTargets} />
        )}
      </section>

      <section id="logs" className="scroll-mt-6">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">API logs <span className="text-xs text-muted-foreground">(beta — mock data)</span></h2>
        <ApiLogsTable rows={apiLogs} />
      </section>
    </div>
  );
}
