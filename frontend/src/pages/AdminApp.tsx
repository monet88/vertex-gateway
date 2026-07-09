import { useEffect, useState, type FormEvent } from 'react';
import { StitchConsoleShell } from '@/components/stitch/StitchConsoleShell';
import { StitchSecurityRail } from '@/components/stitch/StitchSecurityRail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminToken } from '@/hooks/useAdminToken';
import { useAdminView } from '@/hooks/useAdminView';
import { useAdminDashboardData } from '@/hooks/useAdminDashboardData';
import { useDiagnostics } from '@/hooks/useDiagnostics';
import { changeAdminPassword, loginAdmin, logoutAdmin } from '@/lib/admin-dashboard-api';
import { securityNotices as adminSecurityNotices } from '@/data/admin-static';
import { AdminLoginScreen } from '@/pages/AdminLoginScreen';
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

function renderView(
  view: AdminViewId,
  adminData: ReturnType<typeof useAdminDashboardData>,
  token: string,
  diagnostics: ReturnType<typeof useDiagnostics>,
  gateEnabled: boolean,
  setView: (view: AdminViewId) => void,
) {
  switch (view) {
    case 'dashboard':
      return (
        <Dashboard
          adminData={adminData}
          token={token}
          gateEnabled={gateEnabled}
          onNavigate={setView}
        />
      );
    case 'gateway-keys':
      return <GatewayKeysView adminData={adminData} />;
    case 'ai-providers':
      return <AIProvidersView adminData={adminData} token={token} diagnostics={diagnostics} />;
    case 'auth-files':
      return <AuthFilesView adminData={adminData} token={token} />;
    case 'available-models':
      return <AvailableModelsView token={token} />;
    case 'logs-viewer':
      return gateEnabled ? <LogsViewerView token={token} enabled={gateEnabled} /> : null;
    case 'model-management':
      return <ModelManagementView token={token} />;
    default:
      return (
        <Dashboard
          adminData={adminData}
          token={token}
          gateEnabled={gateEnabled}
          onNavigate={setView}
        />
      );
  }
}

export function AdminApp() {
  const { token, setToken } = useAdminToken();
  const { view, setView } = useAdminView();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [rememberSession, setRememberSession] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [gateBanner, setGateBanner] = useState<string | null>(null);
  const dataToken = mustChangePassword ? '' : token;
  const adminData = useAdminDashboardData(dataToken);
  const diagnostics = useDiagnostics(dataToken);
  const gateEnabled = diagnostics.data?.gateEnabled === true;

  useEffect(() => {
    if (view === 'logs-viewer' && diagnostics.data && !gateEnabled) {
      setView('dashboard');
      setGateBanner('Bật Debug Mode và Log to File trong Cấu hình để xem Nhật ký API.');
    }
    if (gateEnabled) {
      setGateBanner(null);
    }
  }, [view, gateEnabled, diagnostics.data, setView, setGateBanner]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const response = await loginAdmin(username, password);
      setToken(response.token, { persist: rememberSession && !response.mustChangePassword });
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
      setToken(response.token, { persist: rememberSession });
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

  if (!isAuthenticated) {
    if (mustChangePassword) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
          <section className="w-full max-w-xl rounded-xl border border-border bg-card p-6">
            <h1 className="mb-4 text-xl font-semibold tracking-tight text-foreground">Change Password Required</h1>
            <form className="grid gap-4" onSubmit={handleChangePassword}>
              <div>
                <Label htmlFor="current-password">Current Password</Label>
                <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="new-password">New Password</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <Button type="submit" disabled={authLoading}>{authLoading ? 'Loading...' : 'Change Password'}</Button>
            </form>
            {authError && (
              <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{authError}</p>
            )}
          </section>
        </main>
      );
    }

    return (
      <AdminLoginScreen
        username={username}
        password={password}
        authError={authError}
        authLoading={authLoading}
        rememberSession={rememberSession}
        onUsernameChange={setUsername}
        onPasswordChange={setPassword}
        onRememberSessionChange={setRememberSession}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <StitchConsoleShell
      rail={<StitchSecurityRail notices={securityNotices} />}
      activeView={view}
      onViewChange={setView}
      onLogout={isAuthenticated ? () => { void handleLogout(); } : undefined}
      health={isAuthenticated ? adminData.health : null}
      gateEnabled={gateEnabled}
    >
      <div className="space-y-8">
        {gateBanner && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {gateBanner}
          </div>
        )}
        {renderView(view, adminData, token, diagnostics, gateEnabled, setView)}
      </div>
    </StitchConsoleShell>
  );
}
