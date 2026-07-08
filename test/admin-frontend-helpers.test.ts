import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { logoutAdminSession } from '../frontend/src/pages/admin-session.js';
import { parseModelCatalogAliases } from '../frontend/src/components/console/model-catalog-form.js';
import { buildAvailableModelRows } from '../frontend/src/pages/available-models-data.js';
import { adminNavItems } from '../frontend/src/data/admin-static.js';

describe('admin frontend helpers', () => {
  it('exposes a first-class gateway key admin view', () => {
    expect(adminNavItems.map((item) => item.id)).toContain('gateway-keys');
    expect(adminNavItems.find((item) => item.id === 'gateway-keys')?.label).toBe('Quản lý Key');
  });

  it('labels model management as model policy rather than security settings', () => {
    expect(adminNavItems.find((item) => item.id === 'model-management')?.label).toBe('Model Policy');
  });

  it('labels upstream credentials as the Agent Platform manager', () => {
    const upstreamManager = adminNavItems.find((item) => item.id === 'auth-files');

    expect(upstreamManager?.label).toBe('Agent Platform Manager');
    expect(upstreamManager?.description).toBe('API keys and project account JSON');
  });

  it('derives shell runtime badge from live health', async () => {
    const { getShellRuntimeBadge } = await import('../frontend/src/components/stitch/shell-runtime-badge.js');

    expect(getShellRuntimeBadge(null)).toEqual({ label: 'Health Unknown', toneClass: 'bg-[var(--warning-amber)]' });
    expect(getShellRuntimeBadge({
      ok: true,
      service: 'vertex-gateway',
      mode: 'file-store',
      runtimeMode: 'pool',
      selection: 'round-robin',
      targetCount: 2,
      healthyTargets: 2,
      degradedTargets: 0,
    })).toEqual({ label: 'Runtime Ready', toneClass: 'bg-[var(--healthy-green)]' });
    expect(getShellRuntimeBadge({
      ok: true,
      service: 'vertex-gateway',
      mode: 'file-store',
      runtimeMode: 'pool',
      selection: 'round-robin',
      targetCount: 2,
      healthyTargets: 1,
      degradedTargets: 1,
    })).toEqual({ label: 'Runtime Degraded', toneClass: 'bg-[var(--warning-amber)]' });
    expect(getShellRuntimeBadge({
      ok: false,
      service: 'vertex-gateway',
      mode: 'file-store',
      runtimeMode: 'pool',
      selection: 'round-robin',
      targetCount: 2,
      healthyTargets: 0,
      degradedTargets: 2,
    })).toEqual({ label: 'Runtime Failed', toneClass: 'bg-[var(--failure-red)]' });
  });

  it('keeps security notices in the shell rail instead of duplicating them on dashboard', () => {
    const dashboardSource = readFileSync(new URL('../frontend/src/pages/Dashboard.tsx', import.meta.url), 'utf8');

    expect(dashboardSource).not.toContain('StitchSecurityRail');
    expect(dashboardSource).not.toContain('adminSecurityNotices');
  });

  it('uses Agent Platform API key naming instead of Vertex Targets on dashboard', () => {
    const dashboardSource = readFileSync(new URL('../frontend/src/pages/Dashboard.tsx', import.meta.url), 'utf8');

    expect(dashboardSource).toContain('Agent Platform API key');
    expect(dashboardSource).not.toContain('Vertex Targets');
  });

  it('keeps service-account import out of the API-key-only dashboard summary', () => {
    const dashboardSource = readFileSync(new URL('../frontend/src/pages/Dashboard.tsx', import.meta.url), 'utf8');

    expect(dashboardSource).not.toContain('ServiceAccountTargetDialog');
    expect(dashboardSource).toContain('apiKeyTargets');
  });

  it('groups upstream credentials into API key and account JSON sections', () => {
    const authFilesSource = readFileSync(new URL('../frontend/src/pages/AuthFilesView.tsx', import.meta.url), 'utf8');

    expect(authFilesSource).toContain('Agent Platform Manager');
    expect(authFilesSource).toContain('Agent Platform API key');
    expect(authFilesSource).toContain('Project Account Json');
    expect(authFilesSource).toContain('target.hasApiKey');
    expect(authFilesSource).toContain("target.authType === 'Service Account JSON'");
    expect(authFilesSource).toContain('pendingIds={pendingIds}');
    expect(authFilesSource).toContain('testResults={testResults}');
  });

  it('copies the full gateway key secret instead of its masked preview', async () => {
    const { getGatewayKeyCopyValue } = await import('../frontend/src/components/console/gateway-key-copy.js');
    const fullSecret = 'vgw_full_secret_value_for_copy';

    expect(getGatewayKeyCopyValue({
      id: 'key-1',
      label: 'Mobile app',
      preview: 'vgw_full...copy',
      status: 'active',
      createdAt: new Date(0).toISOString(),
      secret: fullSecret,
    })).toBe(fullSecret);
    expect(getGatewayKeyCopyValue({
      id: 'key-2',
      label: 'Persisted app',
      preview: 'vgw_mask...only',
      status: 'active',
      createdAt: new Date(0).toISOString(),
    })).toBeNull();
  });

  it('preserves newly created gateway key secrets across refreshed snapshots', async () => {
    const { insertCreatedGatewayKey, mergeGatewayKeySecrets } = await import('../frontend/src/hooks/gateway-key-secrets.js');
    const createdAt = new Date(0).toISOString();
    const secret = 'vgw_new_secret_value';
    const createdGatewayKey = {
      id: 'key-1',
      label: 'Dashboard key',
      preview: 'vgw_new_...alue',
      status: 'active' as const,
      createdAt,
    };

    const withSecret = insertCreatedGatewayKey([], createdGatewayKey, secret);
    const refreshed = mergeGatewayKeySecrets([{ ...createdGatewayKey, preview: 'vgw_new_...alue' }], withSecret);

    expect(withSecret).toEqual([{ ...createdGatewayKey, secret }]);
    expect(refreshed).toEqual([{ ...createdGatewayKey, secret }]);
  });

  it('does not preserve gateway key secrets on revoked refreshed rows', async () => {
    const { mergeGatewayKeySecrets } = await import('../frontend/src/hooks/gateway-key-secrets.js');
    const createdAt = new Date(0).toISOString();
    const currentGatewayKey = {
      id: 'key-1',
      label: 'Dashboard key',
      preview: 'vgw_new_...alue',
      status: 'active' as const,
      createdAt,
      secret: 'vgw_new_secret_value',
    };
    const revokedGatewayKey = {
      id: currentGatewayKey.id,
      label: currentGatewayKey.label,
      preview: currentGatewayKey.preview,
      status: 'revoked' as const,
      createdAt,
      revokedAt: new Date(1).toISOString(),
    };
    const refreshed = mergeGatewayKeySecrets([revokedGatewayKey], [currentGatewayKey]);

    expect(refreshed).toEqual([revokedGatewayKey]);
    expect(refreshed[0]).not.toHaveProperty('secret');
  });

  it('renders a standalone login screen before the admin shell', () => {
    const adminAppSource = readFileSync(new URL('../frontend/src/pages/AdminApp.tsx', import.meta.url), 'utf8');
    const loginScreenSource = readFileSync(new URL('../frontend/src/pages/AdminLoginScreen.tsx', import.meta.url), 'utf8');

    expect(adminAppSource).toContain('AdminLoginScreen');
    expect(adminAppSource).toContain('if (!isAuthenticated)');
    expect(adminAppSource).toContain('const [rememberSession, setRememberSession] = useState(false);');
    expect(loginScreenSource).toContain('Sign in');
    expect(loginScreenSource).toContain('Admin Username');
    expect(loginScreenSource).toContain('Remember session');
  });

  it('sets the browser page title to Vertex Gateway', () => {
    const indexHtml = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');

    expect(indexHtml).toContain('<title>Vertex Gateway</title>');
  });

  it('keeps the standalone login screen on the operator console design system', () => {
    const loginScreenSource = readFileSync(new URL('../frontend/src/pages/AdminLoginScreen.tsx', import.meta.url), 'utf8');

    expect(loginScreenSource).toContain('bg-background');
    expect(loginScreenSource).toContain('operator-panel');
    expect(loginScreenSource).toContain('var(--operator-teal)');
    expect(loginScreenSource).toContain('var(--console-input)');
    expect(loginScreenSource).not.toContain('#f7f7f7');
    expect(loginScreenSource).not.toContain('bg-white');
  });

  it('clears local auth before awaiting remote logout', async () => {
    const events: string[] = [];
    let resolveRemote: (() => void) | undefined;
    const remoteLogout = vi.fn(() => new Promise<void>((resolve) => {
      resolveRemote = () => {
        events.push('remote-resolved');
        resolve();
      };
    }));

    const pending = logoutAdminSession('admin-token', {
      clearLocalAuth: () => {
        events.push('cleared-local-auth');
      },
      revokeServerSession: async (token) => {
        events.push(`remote-start:${token}`);
        await remoteLogout();
      },
    });

    expect(events).toEqual(['cleared-local-auth', 'remote-start:admin-token']);

    resolveRemote?.();
    await pending;

    expect(events).toEqual(['cleared-local-auth', 'remote-start:admin-token', 'remote-resolved']);
  });

  it('still clears local auth when remote logout fails', async () => {
    const events: string[] = [];

    await logoutAdminSession('admin-token', {
      clearLocalAuth: () => {
        events.push('cleared-local-auth');
      },
      revokeServerSession: async () => {
        events.push('remote-start');
        throw new Error('network stalled');
      },
    });

    expect(events).toEqual(['cleared-local-auth', 'remote-start']);
  });

  it('rejects aliases json when any alias value is not a string', () => {
    expect(() => parseModelCatalogAliases('{"fast":"gemini-3.5-flash","bad":123}')).toThrow('Invalid aliases JSON');
  });

  it('parses aliases json when every value is a string', () => {
    expect(parseModelCatalogAliases('{"fast":"gemini-3.5-flash"}')).toEqual({
      fast: 'gemini-3.5-flash',
    });
  });

  it('treats empty aliases json as an empty object', () => {
    expect(parseModelCatalogAliases('')).toEqual({});
    expect(parseModelCatalogAliases('   ')).toEqual({});
  });

  it('builds available model rows from built-ins plus catalog rules', () => {
    expect(buildAvailableModelRows('gemini', {
      builtInModels: ['gemini-3.5-flash', 'gemini-2.5-pro'],
      defaultModel: 'gemini-3.5-flash',
      aliases: { fast: 'gemini-3.5-flash' },
      allowlist: [],
      disabled: ['gemini-2.5-pro'],
    })).toEqual([
      {
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        status: 'disabled',
        aliases: [],
        isDefault: false,
      },
      {
        provider: 'gemini',
        model: 'gemini-3.5-flash',
        status: 'allowed',
        aliases: ['fast'],
        isDefault: true,
      },
    ]);
  });
});
