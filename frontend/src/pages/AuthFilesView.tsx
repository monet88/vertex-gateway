import { useState } from 'react';
import { AdminError, EmptyState, TableSkeleton } from '@/components/console/AdminState';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchPanel } from '@/components/stitch/StitchPanel';
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
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const apiKeyTargets = adminData.vertexTargets.filter((target) => target.hasApiKey);
  const saTargets = adminData.vertexTargets.filter((target) => target.authType === 'Service Account JSON');

  const withPending = async (id: string, fn: () => Promise<void>) => {
    if (pendingIds.has(id)) return;
    setPendingIds((prev) => new Set(prev).add(id));
    setActionError(null);
    try {
      await fn();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleTest = (id: string) => withPending(id, async () => {
    await testVertexCredential({ token }, id);
    await adminData.refetch();
  });

  const handleDelete = (id: string) => withPending(id, async () => {
    await deleteVertexCredential({ token }, id);
    await adminData.refetch();
  });

  const handleUpdate = (id: string, patch: VertexTargetPatchPayload) => withPending(id, async () => {
    await updateVertexCredential({ token }, id, patch);
    await adminData.refetch();
  });

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Agent Platform Manager"
        description="Quản lý upstream credential dùng cho Gateway đến Google: Agent Platform Apikey và project account JSON."
        eyebrow="Gateway -> Google"
        warning={<span>Agent Platform Apikey và service account private key không bao giờ được hiển thị cho client.</span>}
        actions={
          adminData.mutable && (
            <div className="flex flex-wrap gap-2">
              <VertexTargetDialog onCreate={(draft) => adminData.addTarget(draft)} />
              <ServiceAccountTargetDialog onCreate={(draft) => adminData.importTarget(draft)} />
            </div>
          )
        }
      />

      {(adminData.error || actionError) && (
        <AdminError message={actionError ?? adminData.error ?? ''} onRetry={() => { setActionError(null); adminData.refetch(); }} />
      )}

      <StitchPanel title="Agent Platform Apikey" description="API key upstream cho Agent Platform targets. Full key chỉ nhập khi tạo hoặc rotate, không hiển thị lại trong UI.">
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : apiKeyTargets.length === 0 ? (
          <EmptyState title="No Agent Platform Apikey targets" body="Add an Agent Platform Apikey target to route gateway traffic through API-key authentication." />
        ) : (
          <VertexTargetsTable
            rows={apiKeyTargets}
            onTest={handleTest}
            onDelete={adminData.mutable ? handleDelete : undefined}
            onUpdate={adminData.mutable ? handleUpdate : undefined}
            pendingIds={pendingIds}
          />
        )}
      </StitchPanel>

      <StitchPanel title="Project Account Json" description="Service Account JSON targets cho project-level upstream auth.">
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : saTargets.length === 0 ? (
          <EmptyState title="No project account JSON targets" body="Add a project account JSON target when a pool target should authenticate with a service account file." />
        ) : (
          <VertexTargetsTable
            rows={saTargets}
            onTest={handleTest}
            onDelete={adminData.mutable ? handleDelete : undefined}
            onUpdate={adminData.mutable ? handleUpdate : undefined}
          />
        )}
      </StitchPanel>
    </div>
  );
}
