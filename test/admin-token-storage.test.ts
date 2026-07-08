import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  persistAdminToken,
  readPersistedAdminToken,
} from '../frontend/src/lib/admin-token-storage.js';

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
};

describe('admin token browser storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('only persists the admin token in browser storage when explicitly requested', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });

    persistAdminToken('admin-token');
    expect(readPersistedAdminToken()).toBe('');

    persistAdminToken('admin-token', { persist: true });
    expect(readPersistedAdminToken()).toBe('admin-token');

    persistAdminToken('');
    expect(readPersistedAdminToken()).toBe('');
  });

  it('clears browser storage when the caller does not remember the session', () => {
    const localStorage = createStorage();
    vi.stubGlobal('window', { localStorage });

    persistAdminToken('remembered-token');
    persistAdminToken('session-only-token', { persist: false });

    expect(readPersistedAdminToken()).toBe('');
  });

  it('does not throw when browser storage writes fail', () => {
    const localStorage = createStorage();
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.mocked(localStorage.removeItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.stubGlobal('window', { localStorage });

    expect(() => persistAdminToken('admin-token')).not.toThrow();
    expect(() => persistAdminToken('')).not.toThrow();
  });
});
