import { useState } from 'react';
import { persistAdminToken, readPersistedAdminToken } from '@/lib/admin-token-storage';

/**
 * Persisting the admin token keeps local operator sessions usable across page
 * reloads. Logout clears the browser copy via setToken('').
 */
export function useAdminToken() {
  const [token, setTokenState] = useState(readPersistedAdminToken);

  const setToken = (nextToken: string): void => {
    setTokenState(nextToken);
    persistAdminToken(nextToken);
  };

  return { token, setToken };
}
