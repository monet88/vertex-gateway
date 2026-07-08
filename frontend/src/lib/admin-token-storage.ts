const ADMIN_TOKEN_STORAGE_KEY = 'vertex-gateway.admin-token';

export interface AdminTokenStorageOptions {
  /** Browser persistence is opt-in because this is a privileged admin token. */
  readonly persist?: boolean;
}

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readPersistedAdminToken = (): string =>
  getLocalStorage()?.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? '';

export const persistAdminToken = (token: string, options: AdminTokenStorageOptions = {}): void => {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    if (token && options.persist === true) {
      storage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
      return;
    }
    storage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch {
  }
};
