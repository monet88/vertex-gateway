import { useSyncExternalStore } from 'react';
import {
  getAdminTokenSnapshot,
  getServerAdminTokenSnapshot,
  setSharedAdminToken,
  subscribeAdminToken,
} from '@/lib/admin-token-session';

/**
 * A module-scoped store keeps all hook consumers on the same admin session.
 * Browser persistence is explicit opt-in via setToken(token, { persist: true }).
 */
export function useAdminToken() {
  const token = useSyncExternalStore(subscribeAdminToken, getAdminTokenSnapshot, getServerAdminTokenSnapshot);

  return { token, setToken: setSharedAdminToken };
}
