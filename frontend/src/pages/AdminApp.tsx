import { useState, type FormEvent } from 'react';
import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';
import { StitchSecurityRail } from '@/components/stitch/StitchSecurityRail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useAdminView } from '@/hooks/useAdminView';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import { changeAdminPassword, loginAdmin, logoutAdmin } from '@/lib/admin-dashboard-api';
import { securityNotices as adminSecurityNotices } from '@/data/admin-static';
import { Dashboard } from '@/pages/Dashboard';
import { GatewayKeysView } from '@/pages/GatewayKeysView';
import { AIProvidersView } from '@/pages/AIProvidersView';
import { AuthFilesView } from '@/pages/AuthFilesView';
import { AvailableModelsView } from '@/pages/AvailableModelsView';
import { LogsViewerView } from '@/pages/LogsViewerView';
import { ModelManagementView } from '@/pages/ModelManagementView';
import { logoutAdminSession } from '@/pages/admin-session';
import type { AdminViewId } from '@/types/admin';

const securityNotices = adminSecurityNotices.map((message, index) => ({
  id: `notice-${index}`,
  message,
  type: 'info' as const,
  icon: 'info',
}));

function renderView(view: AdminViewId, adminData: ReturnType<typeof useAdminDashboardData>, token: string) {
  switch (view) {
    case 'dashboard':
      return <Dashboard adminData={adminData} />;
    case 'gateway-keys':
      return <GatewayKeysView adminData={adminData} />;
    case 'ai-providers':
      return <AIProvidersView adminData={adminData} token={token} />;
    case 'auth-files':
      return <AuthFilesView adminData={adminData} token={token} />;
    case 'available-models':
      return <AvailableModelsView token={token} />;
    case 'logs-viewer':
      return <LogsViewerView />;
    case 'model-management':
      return <ModelManagementView token={token} />;
    default:
      return <Dashboard adminData={adminData} />;
  }
}

export function AdminApp() {
  const { token, setToken } = useAdminToken();
  const { view, setView } = useAdminView();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const dataToken = mustChangePassword ? '' : token;
  const adminData = useAdminDashboardData(dataToken);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await loginAdmin(username, password);
      setToken(response.token);
      setPassword('');
      if (response.mustChangePassword) {
        setMustChangePassword(true);
      }
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await changeAdminPassword({ token }, currentPassword, newPassword);
      setToken(response.token);
      setCurrentPassword('');
      setNewPassword('');
      setMustChangePassword(false);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    const tokenToInvalidate = token;
    await logoutAdminSession(tokenToInvalidate, {
      clearLocalAuth: () => {
        setToken('');
        setMustChangePassword(false);
      },
      revokeServerSession: async (activeToken) => {
        await logoutAdmin({ token: activeToken });
      },
    });
  };

  const isAuthenticated = Boolean(token) && !mustChangePassword;

  return (
    <StitchConsoleShell
      rail={<StitchSecurityRail notices={securityNotices} />}
      activeView={view}
      onViewChange={setView}
      onLogout={isAuthenticated ? () => { void handleLogout(); } : undefined}
      health={isAuthenticated ? adminData.health : null}
    >
      <div className="space-y-8">
        {!isAuthenticated && (
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 text-xl font-semibold tracking-tight text-foreground">
              {mustChangePassword ? 'Change Password Required' : 'Admin Login'}
            </h2>
            <form
              className="grid gap-3 sm:grid-cols-2 sm:gap-4"
              onSubmit={mustChangePassword ? handleChangePassword : handleLogin}
            >
              {mustChangePassword ? (
                <>
                  <div>
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="new-password">New Password</Label>
                    <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="username-input">Username</Label>
                    <Input id="username-input" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="password-input">Password</Label>
                    <Input id="password-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={authLoading}>
                  {authLoading ? 'Loading…' : mustChangePassword ? 'Change Password' : 'Login'}
                </Button>
              </div>
            </form>
            {authError && (
              <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{authError}</p>
            )}
          </section>
        )}

        {isAuthenticated && renderView(view, adminData, token)}
      </div>
    </StitchConsoleShell>
  );
}
