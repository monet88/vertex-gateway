import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GatewayKeyRow, VertexTargetRow } from '@/data/mockData';
import {
  createGatewayKey,
  createVertexTarget,
  fetchGatewayKeys,
  fetchVertexTargets,
  revokeGatewayKey,
  type VertexTargetDraftPayload,
} from '@/lib/admin-dashboard-api';

interface AdminDashboardState {
  readonly gatewayKeys: readonly GatewayKeyRow[];
  readonly vertexTargets: readonly VertexTargetRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly mutable: boolean;
  readonly latestSecret: string | null;
}

export function useAdminDashboardData(token: string) {
  const [state, setState] = useState<AdminDashboardState>({
    gatewayKeys: [],
    vertexTargets: [],
    loading: false,
    error: null,
    mutable: false,
    latestSecret: null,
  });
  const options = useMemo(() => ({ token }), [token]);

  const refresh = useCallback(async () => {
    if (!token) {
      setState((current) => ({ ...current, gatewayKeys: [], vertexTargets: [], loading: false, error: null, mutable: false }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [keysResponse, targets] = await Promise.all([fetchGatewayKeys(options), fetchVertexTargets(options)]);
      setState((current) => ({
        ...current,
        gatewayKeys: keysResponse.gatewayKeys,
        vertexTargets: targets,
        mutable: keysResponse.mutable,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'Admin API request failed' }));
    }
  }, [options, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createKey = useCallback(async (label: string) => {
    const created = await createGatewayKey(options, label);
    setState((current) => ({ ...current, latestSecret: created.secret }));
    await refresh();
    return created.secret;
  }, [options, refresh]);

  const revokeKey = useCallback(async (id: string) => {
    await revokeGatewayKey(options, id);
    await refresh();
  }, [options, refresh]);

  const createTarget = useCallback(async (draft: VertexTargetDraftPayload) => {
    await createVertexTarget(options, draft);
    await refresh();
  }, [options, refresh]);

  return {
    ...state,
    refresh,
    createKey,
    revokeKey,
    createTarget,
    clearLatestSecret: () => setState((current) => ({ ...current, latestSecret: null })),
  };
}
