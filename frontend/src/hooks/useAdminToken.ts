import { useState } from 'react';

const storageKey = 'vertex-gateway-admin-token';

export function useAdminToken() {
  const [token, setTokenState] = useState(() => sessionStorage.getItem(storageKey) ?? '');

  function setToken(nextToken: string) {
    setTokenState(nextToken);
    if (nextToken) sessionStorage.setItem(storageKey, nextToken);
    else sessionStorage.removeItem(storageKey);
  }

  return { token, setToken };
}
