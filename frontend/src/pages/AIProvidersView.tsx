import { useState } from 'react';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import {
  deleteVertexCredential,
  testVertexCredential,
  updateVertexCredential,
  type VertexTargetPatchPayload,
} from '@/lib/admin-dashboard-api';

interface AIProvidersViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
}

export function AIProvidersView({ adminData, token }: AIProvidersViewProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  const handleTest = async (id: string) => {
    setActionError(null);
    try {
      await testVertexCredential({ token }, id);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Test failed');
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteVertexCredential({ token }, id);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Delete failed');
    }
  };

  const handleUpdate = async (id: string, patch: VertexTargetPatchPayload) => {
    setActionError(null);
    try {
      await updateVertexCredential({ token }, id, patch);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage Vertex targets and gateway keys.</p>
        </div>
        {adminData.mutable && (
          <div className="flex flex-wrap gap-2">
            <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} />
            <VertexTargetDialog onCreate={(draft) => adminData.addTarget(draft)} />
            <ServiceAccountTargetDialog onCreate={(draft) => adminData.importTarget(draft)} />
          </div>
        )}
      </section>

      {(adminData.error || actionError) && (
        <AdminError message={actionError ?? adminData.error ?? ''} onRetry={() => { setActionError(null); adminData.refetch(); }} />
      )}

      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Gateway Keys</h2>
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : (
          <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} mutable={adminData.mutable} />
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Vertex Targets</h2>
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : (
          <VertexTargetsTable
            rows={adminData.vertexTargets}
            onTest={handleTest}
            onDelete={adminData.mutable ? handleDelete : undefined}
            onUpdate={adminData.mutable ? handleUpdate : undefined}
          />
        )}
      </section>
    </div>
  );
}
