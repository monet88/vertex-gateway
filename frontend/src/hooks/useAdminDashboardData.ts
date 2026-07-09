import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GatewayKeyRow, RuntimeHealthSummary, VertexTargetRow } from '@/types/admin';
import { insertCreatedGatewayKey, mergeGatewayKeySecrets } from '@/hooks/gateway-key-secrets';
import { getAdminTokenSessionSnapshot, type AdminTokenSessionSnapshot } from '@/lib/admin-token-session';
import {
  createGatewayKey,
  createVertexTarget,
  deleteGatewayKey,
  fetchAdminHealth,
  fetchGatewayKeys,
  fetchVertexTargets,
  importServiceAccountTarget,
  revokeGatewayKey,
  triggerRuntimeReload,
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

const createStaleSessionError = (): Error =>
  new Error('Admin session changed before action completed');

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
  const options = useMemo(() => ({ token }), [token]);

  useEffect(() => {
    refreshSequence.current += 1;
    return () => {
      refreshSequence.current += 1;
    };
  }, [token]);

  const isCurrentSession = useCallback((sessionAtStart: AdminTokenSessionSnapshot): boolean => {
    const currentSession = getAdminTokenSessionSnapshot();
    return currentSession.token === sessionAtStart.token && currentSession.version === sessionAtStart.version;
  }, []);

  const getSessionForRequest = useCallback((): AdminTokenSessionSnapshot | null => {
    const currentSession = getAdminTokenSessionSnapshot();
    return token && currentSession.token === token ? currentSession : null;
  }, [token]);

  const ensureCurrentSession = useCallback((sessionAtStart: AdminTokenSessionSnapshot): void => {
    if (!isCurrentSession(sessionAtStart)) {
      throw createStaleSessionError();
    }
  }, [isCurrentSession]);

  const refresh = useCallback(async () => {
    const sequence = refreshSequence.current + 1;
    refreshSequence.current = sequence;
    if (!token) {
      setState((current) => ({ ...current, gatewayKeys: [], vertexTargets: [], health: null, loading: false, error: null, mutable: false }));
      return;
    }
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [keysResponse, targets, health] = await Promise.all([
        fetchGatewayKeys(options),
        fetchVertexTargets(options),
        fetchAdminHealth(options),
      ]);
      if (refreshSequence.current !== sequence || !isCurrentSession(sessionAtStart)) return;
      setState((current) => ({
        ...current,
        gatewayKeys: mergeGatewayKeySecrets(keysResponse.gatewayKeys, current.gatewayKeys),
        vertexTargets: targets,
        health,
        mutable: keysResponse.mutable,
        loading: false,
      }));
    } catch (error) {
      if (refreshSequence.current !== sequence || !isCurrentSession(sessionAtStart)) return;
      setState((current) => ({ ...current, loading: false, error: errorMessage(error, 'Admin API request failed') }));
    }
  }, [getSessionForRequest, isCurrentSession, options, token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createKey = useCallback(async (label: string) => {
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) {
      throw new Error('Admin session changed before key creation started');
    }
    try {
      const created = await createGatewayKey(options, label);
      ensureCurrentSession(sessionAtStart);
      setState((current) => ({
        ...current,
        gatewayKeys: insertCreatedGatewayKey(current.gatewayKeys, created.gatewayKey, created.secret),
      }));
      await refresh();
      ensureCurrentSession(sessionAtStart);
      return created.secret;
    } catch (error) {
      if (isCurrentSession(sessionAtStart)) {
        setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create key') }));
      }
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh]);

  const revokeKey = useCallback(async (id: string) => {
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) throw createStaleSessionError();
    try {
      await revokeGatewayKey(options, id);
      ensureCurrentSession(sessionAtStart);
      await refresh();
      ensureCurrentSession(sessionAtStart);
    } catch (error) {
      if (!isCurrentSession(sessionAtStart)) throw error;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to revoke key') }));
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh]);

  const deleteKey = useCallback(async (id: string) => {
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) throw createStaleSessionError();
    try {
      await deleteGatewayKey(options, id);
      ensureCurrentSession(sessionAtStart);
      await refresh();
      ensureCurrentSession(sessionAtStart);
    } catch (error) {
      if (!isCurrentSession(sessionAtStart)) throw error;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to delete key') }));
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh]);

  const addTarget = useCallback(async (draft: VertexTargetDraftPayload) => {
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) throw createStaleSessionError();
    try {
      await createVertexTarget(options, draft);
      ensureCurrentSession(sessionAtStart);
      await refresh();
      ensureCurrentSession(sessionAtStart);
    } catch (error) {
      if (!isCurrentSession(sessionAtStart)) throw error;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to create target') }));
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh]);

  const importTarget = useCallback(async (draft: ServiceAccountTargetDraftPayload) => {
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) throw createStaleSessionError();
    try {
      await importServiceAccountTarget(options, draft);
      ensureCurrentSession(sessionAtStart);
      await refresh();
      ensureCurrentSession(sessionAtStart);
    } catch (error) {
      if (!isCurrentSession(sessionAtStart)) throw error;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to import service account') }));
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh]);

  const reload = useCallback(async () => {
    if (!token) return;
    const sequence = refreshSequence.current + 1;
    const sessionAtStart = getSessionForRequest();
    if (!sessionAtStart) throw createStaleSessionError();
    refreshSequence.current = sequence;
    try {
      await triggerRuntimeReload(options);
      ensureCurrentSession(sessionAtStart);
      const health = await fetchAdminHealth(options);
      ensureCurrentSession(sessionAtStart);
      if (refreshSequence.current !== sequence) return;
      setState((current) => ({ ...current, health }));
      await refresh();
      ensureCurrentSession(sessionAtStart);
    } catch (error) {
      if (refreshSequence.current !== sequence || !isCurrentSession(sessionAtStart)) throw error;
      setState((current) => ({ ...current, error: errorMessage(error, 'Failed to reload runtime') }));
      throw error;
    }
  }, [ensureCurrentSession, getSessionForRequest, isCurrentSession, options, refresh, token]);

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
