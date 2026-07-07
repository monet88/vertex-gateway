import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GatewayKeyRow, VertexTargetRow } from '@/data/mockData';
import {
  createGatewayKey,
  createVertexTarget,
  fetchGatewayKeys,
  fetchVertexTargets,
  importServiceAccountTarget,
  revokeGatewayKey,
  type ServiceAccountTargetDraftPayload,
  type VertexTargetDraftPayload,
} from '@/lib/admin-dashboard-api';

interface AdminDashboardState {
  readonly gatewayKeys: readonly GatewayKeyRow[];
  readonly vertexTargets: readonly VertexTargetRow[];
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
    loading: false,
    error: null,
    mutable: false,
  });
  const refreshSequence = useRef(0);
  const options = useMemo(() => ({ token }), [token]);

  const refresh = useCallback(async () => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    if (!token) {
      setState((current) => ({ ...current, gatewayKeys: [], vertexTargets: [], loading: false, error: null, mutable: false }));
      return;
    }
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [keysResponse, targets] = await Promise.all([fetchGatewayKeys(options), fetchVertexTargets(options)]);
      if (refreshSequence.current !== sequence) return;
      setState((current) => ({
        ...current,
        gatewayKeys: keysResponse.gatewayKeys,
        vertexTargets: targets,
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
    try {
      const created = await createGatewayKey(options, label);
      void refresh();
      return created.secret;
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create key') }));
      throw error;
    }
  }, [options, refresh]);

  const revokeKey = useCallback(async (id: string) => {
    try {
      await revokeGatewayKey(options, id);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to revoke key') }));
    }
  }, [options, refresh]);

  const createTarget = useCallback(async (draft: VertexTargetDraftPayload) => {
    try {
      await createVertexTarget(options, draft);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create target') }));
      throw error;
    }
  }, [options, refresh]);

  const importServiceAccount = useCallback(async (draft: ServiceAccountTargetDraftPayload) => {
    try {
      await importServiceAccountTarget(options, draft);
      await refresh();
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to import service account') }));
      throw error;
    }
  }, [options, refresh]);

  return {
    ...state,
    refresh,
    createKey,
    revokeKey,
    createTarget,
    importServiceAccount,
  };
}
