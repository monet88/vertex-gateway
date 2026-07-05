import { StitchConsoleShell } from '../components/stitch/StitchConsoleShell';
import { StitchKpiStrip } from '../components/stitch/StitchKpiStrip';
import { StitchSecurityRail } from '../components/stitch/StitchSecurityRail';
import { ApiLogsTable } from '../components/ApiLogsTable';
import { GatewayKeysTable } from '../components/GatewayKeysTable';
import { VertexTargetsTable } from '../components/VertexTargetsTable';
import { kpiMetrics, securityNotices } from '../data/mockData';

export function Dashboard() {
  return (
    <StitchConsoleShell rail={<StitchSecurityRail notices={securityNotices} />}>
      <div className="space-y-8">
        <section id="metrics">
          <StitchKpiStrip metrics={kpiMetrics} />
        </section>

        <section id="logs" className="scroll-mt-6">
          <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">API call logs</h2>
          <ApiLogsTable />
        </section>

        <section id="keys" className="scroll-mt-6">
          <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Gateway keys</h2>
          <GatewayKeysTable />
        </section>

        <section id="targets" className="scroll-mt-6">
          <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Vertex targets</h2>
          <VertexTargetsTable />
        </section>
      </div>
    </StitchConsoleShell>
  );
}
