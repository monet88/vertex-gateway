import { useState } from 'react';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { DiagnosticsSettingsPanel } from '@/components/console/DiagnosticsSettingsPanel';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import type { VertexTargetTestResult } from '@/components/console/VertexTargetsTable';
import type { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import type { useDiagnostics } from '@/hooks/useDiagnostics';
import {
  deleteVertexCredential,
  testVertexCredential,
  updateVertexCredential,
  updateRuntimeConfig,
  type VertexTargetPatchPayload,
} from '@/lib/admin-dashboard-api';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { VertexPoolSelection } from '@/types/admin';

interface AIProvidersViewProps {
  readonly adminData: ReturnType<typeof useAdminDashboardData>;
  readonly token: string;
  readonly diagnostics: ReturnType<typeof useDiagnostics>;
}

export function AIProvidersView({ adminData, token, diagnostics }: AIProvidersViewProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [testResults, setTestResults] = useState<ReadonlyMap<string, VertexTargetTestResult>>(new Map());

  const clearTestResult = (id: string): void => {
    setTestResults((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const handleTest = async (id: string) => {
    if (pendingIds.has(id)) return;
    setActionError(null);
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      await testVertexCredential({ token }, id);
      setTestResults((prev) => new Map(prev).set(id, {
        status: 'success',
        message: 'Agent Platform API key test passed',
        testedAt: new Date().toLocaleTimeString(),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test failed';
      setActionError(message);
      setTestResults((prev) => new Map(prev).set(id, {
        status: 'error',
        message,
        testedAt: new Date().toLocaleTimeString(),
      }));
      return;
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }

    try {
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Refresh failed after successful test');
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
      clearTestResult(id);
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Update failed');
    }
  };

  const handleSelectionChange = async (vertexPoolSelection: VertexPoolSelection) => {
    setActionError(null);
    try {
      await updateRuntimeConfig({ token }, { vertexPoolSelection });
      await adminData.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Update failed');
    }
  };

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Cấu hình Routing"
        description="Điều phối Agent Platform API key targets, selection mode, và health probes."
        actions={
          adminData.mutable && (
            <div className="flex flex-wrap gap-2">
              <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} />
              <VertexTargetDialog onCreate={(draft) => adminData.addTarget(draft)} />
              <ServiceAccountTargetDialog onCreate={(draft) => adminData.importTarget(draft)} />
            </div>
          )
        }
      />

      {(adminData.error || actionError) && (
        <AdminError message={actionError ?? adminData.error ?? ''} onRetry={() => { setActionError(null); adminData.refetch(); }} />
      )}

      <StitchPanel title="Gateway Keys">
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={5} />
        ) : (
          <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} onDelete={(id) => adminData.deleteKey(id)} mutable={adminData.mutable} />
        )}
      </StitchPanel>

      <StitchPanel
        title="Agent Platform API key"
        actions={
          <div className="flex items-center gap-3">
            <Label htmlFor="pool-selection" className="whitespace-nowrap">Pool selection</Label>
            <Select value={adminData.health?.selection ?? 'round-robin'} onValueChange={handleSelectionChange} disabled={!adminData.mutable || adminData.loading}>
              <SelectTrigger id="pool-selection" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="round-robin">round-robin</SelectItem>
                <SelectItem value="bind-first">bind-first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {adminData.loading ? (
          <TableSkeleton rows={3} columns={6} />
        ) : (
          <VertexTargetsTable
            rows={adminData.vertexTargets}
            onTest={handleTest}
            onDelete={adminData.mutable ? handleDelete : undefined}
            onUpdate={adminData.mutable ? handleUpdate : undefined}
            pendingIds={pendingIds}
            testResults={testResults}
          />
        )}
      </StitchPanel>

      <DiagnosticsSettingsPanel diagnostics={diagnostics} token={token} />
    </div>
  );
}
