import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';
import { StitchKpiStrip } from '@/components/stitch/StitchKpiStrip';
import { StitchSecurityRail } from '@/components/stitch/StitchSecurityRail';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { SecretInput } from '@/components/console/SecretInput';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import { kpiMetrics, securityNotices, apiLogs } from '@/data/mockData';

export function Dashboard() {
  const { token, setToken } = useAdminToken();
  const adminData = useAdminDashboardData(token);

  return (
    <StitchConsoleShell rail={<StitchSecurityRail notices={securityNotices} />}>
      <div className="space-y-8">
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vertex Gateway Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">Console tách riêng cho gateway keys, Vertex targets, logs và domain policy.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-72">
              <SecretInput id="admin-token" label="Admin token" value={token} onChange={setToken} placeholder="Bearer token" />
            </div>
            <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} disabled={!adminData.mutable} />
            <VertexTargetDialog onCreate={(target) => adminData.createTarget(target)} disabled={!adminData.mutable} />
            <ServiceAccountTargetDialog onCreate={(target) => adminData.importServiceAccount(target)} disabled={!adminData.mutable} />
          </div>
        </section>

        <section id="metrics">
          <StitchKpiStrip metrics={kpiMetrics} />
        </section>

        <section id="logs" className="scroll-mt-6">
          <ApiLogsTable rows={apiLogs} />
        </section>

        <section id="keys" className="scroll-mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Gateway keys</h2>
            {adminData.loading && <span className="text-sm text-muted-foreground">Đang tải dữ liệu admin...</span>}
          </div>
          {adminData.error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {adminData.error}
            </p>
          )}
          <GatewayKeysTable rows={adminData.gatewayKeys} onRevoke={(id) => adminData.revokeKey(id)} mutable={adminData.mutable} />
        </section>

        <section id="targets" className="scroll-mt-6">
          <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Vertex targets</h2>
          <VertexTargetsTable rows={adminData.vertexTargets} />
        </section>
      </div>
    </StitchConsoleShell>
  );
}
