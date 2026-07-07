import { describe, expect, it, vi } from 'vitest';
import { logoutAdminSession } from '../frontend/src/pages/admin-session.js';
import { parseModelCatalogAliases } from '../frontend/src/components/console/model-catalog-form.js';

describe('admin frontend helpers', () => {
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
});
