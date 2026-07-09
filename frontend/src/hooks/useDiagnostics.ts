import { useCallback, useEffect, useState } from 'react';
import { fetchDiagnostics, updateDiagnostics } from '@/lib/admin-dashboard-api';
import type { DiagnosticsSnapshot } from '@/types/admin';

export function useDiagnostics(token: string) {
  const [data, setData] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchDiagnostics({ token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setFlags = async (patch: { debugMode?: boolean; logToFile?: boolean }) => {
    setUpdating(true);
    setError(null);
    try {
      const next = await updateDiagnostics({ token }, patch);
      setData(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update diagnostics');
      throw err;
    } finally {
      setUpdating(false);
    }
  };

  return { data, loading, updating, error, refetch, setFlags };
}
