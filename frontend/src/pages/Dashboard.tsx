import { useState } from 'react';
import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';
import { StitchKpiStrip } from '@/components/stitch/StitchKpiStrip';
import { StitchSecurityRail } from '@/components/stitch/StitchSecurityRail';
import { ApiLogsTable } from '@/components/console/ApiLogsTable';
import { GatewayKeysTable } from '@/components/console/GatewayKeysTable';
import { VertexTargetsTable } from '@/components/console/VertexTargetsTable';
import { GatewayKeyDialog } from '@/components/console/GatewayKeyDialog';
import { ServiceAccountTargetDialog } from '@/components/console/ServiceAccountTargetDialog';
import { VertexTargetDialog } from '@/components/console/VertexTargetDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import { changeAdminPassword, loginAdmin } from '@/lib/admin-dashboard-api';
import { apiLogs } from '@/data/mockData';
import { securityNotices as adminSecurityNotices } from '@/data/admin-static';

const kpiMetrics = [
  { id: 'kpi-keys', label: 'Active Gateway Keys', value: '–', colorScheme: 'primary' as const },
  { id: 'kpi-targets', label: 'Vertex Targets', value: '–', colorScheme: 'secondary' as const },
];

const securityNotices = adminSecurityNotices.map((message, index) => ({
  id: `notice-${index}`,
  message,
  type: 'info' as const,
  icon: 'info',
}));

export function Dashboard() {
  const { token, setToken } = useAdminToken();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const dataToken = mustChangePassword ? '' : token;
  const adminData = useAdminDashboardData(dataToken);

  async function submitLogin() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await loginAdmin(username, password);
      setToken(response.token);
      setMustChangePassword(response.mustChangePassword);
      if (!response.mustChangePassword) setPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Admin login failed');
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitPasswordChange() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await changeAdminPassword({ token }, currentPassword, newPassword);
      setToken(response.token);
      setCurrentPassword('');
      setNewPassword('');
      setPassword('');
      setMustChangePassword(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Failed to change admin password');
    } finally {
      setAuthLoading(false);
    }
  }

  const isAuthenticated = Boolean(token) && !mustChangePassword;

  return (
    <StitchConsoleShell rail={<StitchSecurityRail notices={securityNotices} />}>
      <div className="space-y-8">
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Vertex Gateway Admin</h1>
            <p className="mt-1 text-sm text-muted-foreground">Console tách riêng cho gateway keys, Vertex targets, logs và domain policy.</p>
          </div>
          {isAuthenticated && (
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="secondary" onClick={() => { setToken(''); setMustChangePassword(false); }}>Logout</Button>
              <GatewayKeyDialog onCreate={(label) => adminData.createKey(label)} disabled={!adminData.mutable} />
              <VertexTargetDialog onCreate={(target) => adminData.createTarget(target)} disabled={!adminData.mutable} />
              <ServiceAccountTargetDialog onCreate={(target) => adminData.importServiceAccount(target)} disabled={!adminData.mutable} />
            </div>
          )}
        </section>

        {!isAuthenticated && (
          <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
            {mustChangePassword ? (
              <>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Change admin password</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Default password must be changed before the dashboard loads.</p>
                </div>
                <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submitPasswordChange(); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="current-password">Current password</Label>
                      <Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="new-password">New password</Label>
                      <Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    </div>
                  </div>
                  <Button type="submit" className="w-fit" disabled={authLoading || !token || currentPassword.length === 0 || newPassword.length < 8}>
                    {authLoading ? 'Đang lưu...' : 'Change password'}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Admin login</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Use admin / changeme on first login.</p>
                </div>
                <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="admin-username">Username</Label>
                      <Input id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="admin-password">Password</Label>
                      <Input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                    </div>
                  </div>
                  <Button type="submit" className="w-fit" disabled={authLoading || username.trim().length === 0 || password.length === 0}>
                    {authLoading ? 'Đang đăng nhập...' : 'Login'}
                  </Button>
                </form>
              </>
            )}
            {authError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{authError}</p>
            )}
          </section>
        )}

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
