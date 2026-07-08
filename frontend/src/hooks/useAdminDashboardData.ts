import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GatewayKeyRow, RuntimeHealthSummary, VertexTargetRow } from '@/types/admin';
import { insertCreatedGatewayKey, mergeGatewayKeySecrets } from '@/hooks/gateway-key-secrets';
import {
  createGatewayKey,
  createVertexTarget,
  deleteGatewayKey,
  fetchAdminHealth,
  fetchGatewayKeys,
  fetchVertexTargets,
  importServiceAccountTarget,
  reloadRuntime,
  revokeGatewayKey,
  type ServiceAccountTargetDraftPayload,
  type VertexTargetDraftPayload,
} from '@/lib/admin-dashboard-api';

interface AdminDashboardState {
  readonly gatewayKeys: readonly GatewayKeyRow[];
  readonly vertexTargets: readonly VertexTargetRow[];
  readonly health: RuntimeHealthSummary | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly mutable: boolean;
}

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export function useAdminDashboardData(token: string) {
  const [state, setState] = useState<AdminDashboardState>({
    gatewayKeys: [],
    vertexTargets: [],
    health: null,
    loading: false,
    error: null,
    mutable: false,
  });
  const refreshSequence = useRef(0);
  const tokenRef = useRef(token);
  const tokenVersionRef = useRef(0);
  const options = useMemo(() => ({ token }), [token]);

  useLayoutEffect(() => {
    tokenRef.current = token;
    tokenVersionRef.current += 1;
    refreshSequence.current += 1;
    return () => {
      tokenVersionRef.current += 1;
      refreshSequence.current += 1;
    };
  }, [token]);

  const isCurrentSession = useCallback((tokenAtStart: string, versionAtStart: number): boolean =>
    tokenRef.current === tokenAtStart && tokenVersionRef.current === versionAtStart, []);

  const refresh = useCallback(async () => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    if (!token) {
      setState((current) => ({ ...current, gatewayKeys: [], vertexTargets: [], health: null, loading: false, error: null, mutable: false }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [keysResponse, targets, health] = await Promise.all([
        fetchGatewayKeys(options),
        fetchVertexTargets(options),
        fetchAdminHealth(options),
      ]);
      if (refreshSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        gatewayKeys: mergeGatewayKeySecrets(keysResponse.gatewayKeys, current.gatewayKeys),
        vertexTargets: targets,
        health,
        mutable: keysResponse.mutable,
        loading: false,
      }));
    } catch (error) {
      if (refreshSequence.current !== sequence) return;
      setState((current) => ({ ...current, loading: false, error: errorMessage(error, 'Admin API request failed') }));
    }
  }, [options, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createKey = useCallback(async (label: string) => {
    const tokenAtStart = tokenRef.current;
    const tokenVersionAtStart = tokenVersionRef.current;
    try {
      const created = await createGatewayKey(options, label);
      if (!isCurrentSession(tokenAtStart, tokenVersionAtStart)) {
        throw new Error('Admin session changed before key creation completed');
      }
      setState((current) => ({
        ...current,
        gatewayKeys: insertCreatedGatewayKey(current.gatewayKeys, created.gatewayKey, created.secret),
      }));
      void refresh();
      return created.secret;
    } catch (error) {
      if (isCurrentSession(tokenAtStart, tokenVersionAtStart)) {
        setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create key') }));
      }
      throw error;
    }
  }, [isCurrentSession, options, refresh]);

  const revokeKey = useCallback(async (id: string) => {
    try {
      await revokeGatewayKey(options, id);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to revoke key') }));
    }
  }, [options, refresh]);

  const deleteKey = useCallback(async (id: string) => {
    try {
      await deleteGatewayKey(options, id);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to delete key') }));
    }
  }, [options, refresh]);

  const addTarget = useCallback(async (draft: VertexTargetDraftPayload) => {
    try {
      await createVertexTarget(options, draft);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create target') }));
      throw error;
    }
  }, [options, refresh]);

  const importTarget = useCallback(async (draft: ServiceAccountTargetDraftPayload) => {
    try {
      await importServiceAccountTarget(options, draft);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to import service account') }));
      throw error;
    }
  }, [options, refresh]);

  const reload = useCallback(async () => {
    if (!token) return;
    const sequence = refreshSequence.current + 1;
    const tokenAtStart = token;
    refreshSequence.current = sequence;
    try {
      const health = await reloadRuntime(options);
      if (refreshSequence.current !== sequence || tokenRef.current !== tokenAtStart) return;
      setState((current) => ({ ...current, health }));
      await refresh();
    } catch (error) {
      if (refreshSequence.current !== sequence || tokenRef.current !== tokenAtStart) return;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to reload runtime') }));
    }
  }, [options, refresh, token]);

  return {
    ...state,
    refresh,
    refetch: refresh,
    createKey,
    revokeKey,
    deleteKey,
    addTarget,
    importTarget,
    reload,
  };
}
