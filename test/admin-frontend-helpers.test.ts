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
