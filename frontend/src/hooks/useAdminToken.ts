import { useState } from 'react';

const storageKey = 'vertex-gateway-admin-token';

function readStoredToken(): string {
  try {
    return typeof window !== 'undefined' ? sessionStorage.getItem(storageKey) ?? '' : '';
  } catch {
    return '';
  }
}

export function useAdminToken() {
  const [token, setTokenState] = useState(readStoredToken);

  function setToken(nextToken: string) {
    setTokenState(nextToken);
    try {
      if (nextToken) sessionStorage.setItem(storageKey, nextToken);
      else sessionStorage.removeItem(storageKey);
    } catch (error) {
      console.warn('sessionStorage is not available:', error);
    }
  }

  return { token, setToken };
}