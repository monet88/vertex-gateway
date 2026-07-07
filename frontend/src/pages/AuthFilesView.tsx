import { AdminError, EmptyState, TableSkeleton } from '@/components/console/AdminState';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';

interface AuthFilesViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
}

export function AuthFilesView({ adminData }: AuthFilesViewProps) {
  const saTargets = adminData.vertexTargets.filter((target) => target.authType === 'Service Account JSON');

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Auth Files</h1>
        <p className="mt-1 text-sm text-muted-foreground">Service account credentials used by the gateway for upstream Google API calls.</p>
      </section>

      {adminData.error && <AdminError message={adminData.error} onRetry={() => adminData.refetch()} />}

      {adminData.loading ? (
        <TableSkeleton rows={3} columns={6} />
      ) : saTargets.length === 0 ? (
        <EmptyState title="No service account targets" body="All targets use API key authentication. Add a service account via AI Providers view." />
      ) : (
        <VertexTargetsTable rows={saTargets} />
      )}
    </div>
  );
}
