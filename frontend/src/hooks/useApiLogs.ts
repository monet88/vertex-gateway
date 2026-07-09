import { useCallback, useEffect, useState } from 'react';
import { clearApiLogs, fetchApiLogs } from '@/lib/admin-dashboard-api';
import type { ApiCallLogEntry } from '@/types/admin';

export interface ApiLogsQuery {
  readonly statusClass?: string;
  readonly routeFamily?: string;
  readonly method?: string;
  readonly search?: string;
  readonly limit?: number;
}

export function useApiLogs(token: string, enabled: boolean, query: ApiLogsQuery = {}) {
  const [entries, setEntries] = useState<ApiCallLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApiLogs({ token }, query);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [token, enabled, query.statusClass, query.routeFamily, query.method, query.search, query.limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh || !enabled) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, enabled, refresh]);

  const clear = async () => {
    if (!window.confirm('Xóa toàn bộ log trong bộ nhớ và file log hiện tại?')) return;
    setError(null);
    try {
      await clearApiLogs({ token });
      setEntries([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear logs');
    }
  };

  return { entries, loading, error, refresh, autoRefresh, setAutoRefresh, clear };
}
