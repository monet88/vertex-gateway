import { adminFetch, type AdminApiOptions } from './admin-api';
import type { GatewayKeyRow, ProviderModelCatalog, RuntimeHealthSummary, VertexTargetRow } from '@/types/admin';

export interface AdminGatewayKeyRecord extends GatewayKeyRow {
  readonly revokedAt?: string;
}
export interface GatewayKeysResponse {
  readonly mode: 'static-config' | 'file-store';
  readonly mutable: boolean;
  readonly gatewayKeys: AdminGatewayKeyRecord[];
}

interface AdminVertexCredentialRecord {
  readonly id: string;
  readonly label?: string;
  readonly project: string;
  readonly location: string;
  readonly credentialsFile: string | null;
  readonly hasApiKey: boolean;
  readonly apiKeyMode: 'full' | 'express';
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelAllowlist?: readonly string[];
  readonly modelExclusions?: readonly string[];
  readonly email?: string;
  readonly health?: { readonly status?: string };
}
interface VertexCredentialsResponse {
  readonly vertexPools: AdminVertexCredentialRecord[];
}

export interface AdminLoginResponse {
  readonly ok: true;
  readonly username: string;
  readonly token: string;
  readonly mustChangePassword: boolean;
}

const mapHealth = (record: AdminVertexCredentialRecord): VertexTargetRow['health'] => {
  if (record.health?.status === 'healthy') return 'ready';
  if (record.health?.status === 'cooldown') return 'degraded';
  if (record.health?.status === 'disabled') return 'disabled';
  if (record.health?.status === 'failed') return 'failed';
  return 'unknown';
};

export const mapVertexTarget = (record: AdminVertexCredentialRecord): VertexTargetRow => ({
  id: record.id,
  label: record.label ?? record.id,
  project: record.project,
  location: record.location,
  authType: record.hasApiKey ? 'Google Cloud API key' : 'Service Account JSON',
  apiKeyMode: record.apiKeyMode,
  enabled: record.enabled !== false,
  weight: record.weight ?? 1,
  modelAllowlist: record.modelAllowlist ?? [],
  modelExclusions: record.modelExclusions ?? [],
  credentialsFile: record.credentialsFile,
  hasApiKey: record.hasApiKey,
  email: record.email,
  health: mapHealth(record),
});

export async function fetchGatewayKeys(options: AdminApiOptions): Promise<GatewayKeysResponse> {
  return adminFetch<GatewayKeysResponse>('/admin/api/gateway-keys', options);
}

export async function fetchVertexTargets(options: AdminApiOptions): Promise<VertexTargetRow[]> {
  const response = await adminFetch<VertexCredentialsResponse>('/admin/api/vertex-credentials', options);
  return response.vertexPools.map(mapVertexTarget);
}

export async function createGatewayKey(options: AdminApiOptions, label: string) {
  return adminFetch<{ ok: true; gatewayKey: AdminGatewayKeyRecord; secret: string }>('/admin/api/gateway-keys', options, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}

export async function revokeGatewayKey(options: AdminApiOptions, id: string) {
  return adminFetch<{ ok: true; gatewayKey: AdminGatewayKeyRecord }>(`/admin/api/gateway-keys/${encodeURIComponent(id)}/revoke`, options, {
    method: 'POST',
  });
}

export async function loginAdmin(username: string, password: string): Promise<AdminLoginResponse> {
  return adminFetch<AdminLoginResponse>('/admin/api/auth/login', { token: '' }, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function changeAdminPassword(options: AdminApiOptions, currentPassword: string, newPassword: string) {
  return adminFetch<{ ok: true; username: string; token: string }>('/admin/api/auth/change-password', options, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface VertexTargetDraftPayload { readonly label: string; readonly project: string; readonly location: string; readonly apiKey: string; }
export interface ServiceAccountTargetDraftPayload { readonly label: string; readonly project: string; readonly location: string; readonly credential: Record<string, unknown>; }

export async function createVertexTarget(options: AdminApiOptions, draft: VertexTargetDraftPayload): Promise<VertexTargetRow> {
  const response = await adminFetch<{ ok: true; credential: AdminVertexCredentialRecord }>('/admin/api/vertex-credentials/api-key', options, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
  return mapVertexTarget(response.credential);
}

export async function importServiceAccountTarget(options: AdminApiOptions, draft: ServiceAccountTargetDraftPayload): Promise<VertexTargetRow> {
  const response = await adminFetch<{ ok: true; credential: AdminVertexCredentialRecord }>('/admin/api/vertex-credentials/import', options, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
  return mapVertexTarget(response.credential);
}

export async function fetchAdminHealth(options: AdminApiOptions): Promise<RuntimeHealthSummary> {
  const response = await adminFetch<{
    ok: true;
    service: string;
    mode: RuntimeHealthSummary['mode'];
    runtime: { mode?: string; active?: { targets?: Array<{ health?: { status?: string } }> } };
  }>('/admin/api/health', options);
  const targets = response.runtime.active?.targets ?? [];
  return {
    ok: response.ok,
    service: response.service,
    mode: response.mode,
    runtimeMode: response.runtime.mode ?? 'unknown',
    targetCount: targets.length,
    healthyTargets: targets.filter((target) => target.health?.status === 'healthy').length,
    degradedTargets: targets.filter((target) => target.health?.status && target.health.status !== 'healthy').length,
  };
}

export async function fetchVertexCredential(options: AdminApiOptions, id: string): Promise<VertexTargetRow> {
  const response = await adminFetch<AdminVertexCredentialRecord>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options);
  return mapVertexTarget(response);
}

export interface VertexTargetPatchPayload {
  readonly label?: string;
  readonly project?: string;
  readonly location?: string;
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelAllowlist?: readonly string[];
  readonly modelExclusions?: readonly string[];
}

export async function updateVertexCredential(options: AdminApiOptions, id: string, patch: VertexTargetPatchPayload): Promise<VertexTargetRow> {
  const response = await adminFetch<{ ok: true; credential: AdminVertexCredentialRecord }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return mapVertexTarget(response.credential);
}

export async function deleteVertexCredential(options: AdminApiOptions, id: string): Promise<void> {
  await adminFetch<{ ok: true; remaining: number }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}`, options, { method: 'DELETE' });
}

export async function testVertexCredential(options: AdminApiOptions, id: string) {
  return adminFetch<{ ok: true; id: string; response: unknown }>(`/admin/api/vertex-credentials/${encodeURIComponent(id)}/test`, options, { method: 'POST' });
}

export async function fetchModelCatalog(options: AdminApiOptions, provider = 'gemini'): Promise<ProviderModelCatalog> {
  return adminFetch<ProviderModelCatalog>(`/admin/api/models?provider=${encodeURIComponent(provider)}`, options);
}

export async function saveModelCatalog(options: AdminApiOptions, provider: string, catalog: ProviderModelCatalog): Promise<ProviderModelCatalog> {
  const response = await adminFetch<{ ok: true; modelCatalog: ProviderModelCatalog }>(`/admin/api/models/${encodeURIComponent(provider)}`, options, {
    method: 'PUT',
    body: JSON.stringify(catalog),
  });
  return response.modelCatalog;
}

export async function reloadRuntime(options: AdminApiOptions): Promise<RuntimeHealthSummary> {
  await adminFetch<{ ok: true; runtime: unknown }>('/admin/api/runtime/reload', options, { method: 'POST' });
  return fetchAdminHealth(options);
}
