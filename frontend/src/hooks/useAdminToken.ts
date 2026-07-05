import { useState } from 'react';

/**
 * Admin token is kept in memory only for the lifetime of the tab.
 * It is intentionally NOT persisted to sessionStorage/localStorage so that
 * an XSS payload cannot read a long-lived admin credential from Web Storage.
 * Reloading the page clears the token and the operator re-enters it.
 */
export function useAdminToken() {
  const [token, setToken] = useState('');

  return { token, setToken };
}
