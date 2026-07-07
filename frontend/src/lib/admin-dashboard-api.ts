import { adminFetch, type AdminApiOptions } from './admin-api';
import type { GatewayKeyRow, VertexTargetRow } from '@/types/admin';

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
