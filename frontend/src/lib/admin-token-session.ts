import { persistAdminToken, readPersistedAdminToken, type AdminTokenStorageOptions } from './admin-token-storage';

export interface AdminTokenSessionSnapshot {
  readonly token: string;
  readonly version: number;
}

type TokenListener = () => void;

let currentToken = readPersistedAdminToken();
let currentVersion = 0;
const listeners = new Set<TokenListener>();

const emitTokenChange = (): void => {
  listeners.forEach((listener) => listener());
};

export const subscribeAdminToken = (listener: TokenListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getAdminTokenSnapshot = (): string => currentToken;

export const getServerAdminTokenSnapshot = (): string => '';

export const getAdminTokenSessionSnapshot = (): AdminTokenSessionSnapshot => ({
  token: currentToken,
  version: currentVersion,
});

export const setSharedAdminToken = (nextToken: string, options?: AdminTokenStorageOptions): void => {
  currentToken = nextToken;
  currentVersion += 1;
  persistAdminToken(nextToken, options);
  emitTokenChange();
};
