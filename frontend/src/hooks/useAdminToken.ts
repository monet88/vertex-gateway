import { useSyncExternalStore } from 'react';
import { persistAdminToken, readPersistedAdminToken, type AdminTokenStorageOptions } from '@/lib/admin-token-storage';

/**
 * A module-scoped store keeps all hook consumers on the same admin session.
 * Browser persistence is explicit opt-in via setToken(token, { persist: true }).
 */
type TokenListener = () => void;

let currentToken = readPersistedAdminToken();
const listeners = new Set<TokenListener>();

const emitTokenChange = (): void => {
  listeners.forEach((listener) => listener());
};

const subscribeToken = (listener: TokenListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getTokenSnapshot = (): string => currentToken;
const getServerTokenSnapshot = (): string => '';

const setSharedAdminToken = (nextToken: string, options?: AdminTokenStorageOptions): void => {
  currentToken = nextToken;
  persistAdminToken(nextToken, options);
  emitTokenChange();
};

export function useAdminToken() {
  const token = useSyncExternalStore(subscribeToken, getTokenSnapshot, getServerTokenSnapshot);

  return { token, setToken: setSharedAdminToken };
}
