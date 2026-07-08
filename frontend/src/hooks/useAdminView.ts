import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { adminNavItems } from '@/data/admin-static';
import type { AdminViewId } from '@/types/admin';

const validViews = new Set<AdminViewId>(adminNavItems.map((item) => item.id));

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener('popstate', onStoreChange);
  return () => window.removeEventListener('popstate', onStoreChange);
};

const getSnapshot = () => window.location.search;

export function useAdminView() {
  const search = useSyncExternalStore(subscribe, getSnapshot, () => '');
  const view = useMemo<AdminViewId>(() => {
    const value = new URLSearchParams(search).get('view');
    return value && validViews.has(value as AdminViewId) ? (value as AdminViewId) : 'dashboard';
  }, [search]);

  const setView = useCallback((nextView: AdminViewId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('view', nextView);
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  return { view, setView };
}
