import { useState } from 'react';
import { AdminError, EmptyState, TableSkeleton } from '@/components/console/AdminState';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import {
  deleteVertexCredential,
  testVertexCredential,
  updateVertexCredential,
  type VertexTargetPatchPayload,
} from '@/lib/admin-dashboard-api';

interface AuthFilesViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
}

export function AuthFilesView({ adminData, token }: AuthFilesViewProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const saTargets = adminData.vertexTargets.filter((target) => target.authType === 'Service Account JSON');

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
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Auth Files</h1>
        <p className="mt-1 text-sm text-muted-foreground">Service account credentials used by the gateway for upstream Google API calls.</p>
      </section>

      {(adminData.error || actionError) && (
        <AdminError message={actionError ?? adminData.error ?? ''} onRetry={() => { setActionError(null); adminData.refetch(); }} />
      )}

      {adminData.loading ? (
        <TableSkeleton rows={3} columns={6} />
      ) : saTargets.length === 0 ? (
        <EmptyState title="No service account targets" body="All targets use API key authentication. Add a service account via AI Providers view." />
      ) : (
        <VertexTargetsTable
          rows={saTargets}
          onTest={handleTest}
          onDelete={adminData.mutable ? handleDelete : undefined}
          onUpdate={adminData.mutable ? handleUpdate : undefined}
        />
      )}
    </div>
  );
}
