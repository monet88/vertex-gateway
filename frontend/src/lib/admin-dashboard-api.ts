import { adminFetch, type AdminApiOptions } from './admin-api';
import type {
  ApiCallLogEntry,
  DiagnosticsSnapshot,
  GatewayKeyRow,
  ProviderModelCatalog,
  RuntimeHealthSummary,
  VertexPoolSelection,
  VertexTargetRow,
} from '@/types/admin';

export interface AdminProviderModelCatalog extends ProviderModelCatalog {
  readonly builtInModels?: readonly string[];
}

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
  readonly apiKeyMode?: VertexTargetRow['apiKeyMode'];
  readonly enabled?: boolean;
  readonly weight?: number;
  readonly modelAllowlist?: readonly string[];
  readonly modelExclusions?: readonly string[];
  readonly email?: string;
  readonly health?: { readonly status?: string };
}
interface VertexCredentialsResponse {
  readonly vertexPoolSelection?: VertexPoolSelection;
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
  authType: record.hasApiKey ? 'Agent Platform API key' : 'Service Account JSON',
  apiKeyMode: record.apiKeyMode ?? 'full',
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

export async function deleteGatewayKey(options: AdminApiOptions, id: string) {
  return adminFetch<{ ok: true; gatewayKey: AdminGatewayKeyRecord }>(`/admin/api/gateway-keys/${encodeURIComponent(id)}`, options, {
    method: 'DELETE',
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

export async function logoutAdmin(options: AdminApiOptions): Promise<void> {
  await adminFetch<{ ok: true }>('/admin/api/auth/logout', options, { method: 'POST' });
}

export interface VertexTargetDraftPayload { readonly label: string; readonly project: string; readonly location: string; readonly apiKey: string; readonly apiKeyMode: VertexTargetRow['apiKeyMode']; }
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

const isActionableDegradedStatus = (status: string | undefined): boolean =>
  status === 'cooldown' || status === 'failed';

export async function fetchAdminHealth(options: AdminApiOptions): Promise<RuntimeHealthSummary> {
  const response = await adminFetch<{
    ok: true;
    service: string;
    mode: RuntimeHealthSummary['mode'];
    runtime: { mode?: string; active?: { selection?: VertexPoolSelection; targets?: Array<{ health?: { status?: string } }> } };
  }>('/admin/api/health', options);
  const targets = response.runtime.active?.targets ?? [];
  return {
    ok: response.ok,
    service: response.service,
    mode: response.mode,
    runtimeMode: response.runtime.mode ?? 'unknown',
    selection: response.runtime.active?.selection ?? 'round-robin',
    targetCount: targets.length,
    healthyTargets: targets.filter((target) => target.health?.status === 'healthy').length,
    degradedTargets: targets.filter((target) => isActionableDegradedStatus(target.health?.status)).length,
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
  readonly apiKey?: string;
  readonly apiKeyMode?: VertexTargetRow['apiKeyMode'];
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

export async function updateRuntimeConfig(options: AdminApiOptions, patch: { readonly vertexPoolSelection: VertexPoolSelection }) {
  return adminFetch<{ ok: true; vertexPoolSelection: VertexPoolSelection }>('/admin/api/runtime-config', options, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchModelCatalog(options: AdminApiOptions, provider = 'gemini'): Promise<AdminProviderModelCatalog> {
  return adminFetch<AdminProviderModelCatalog>(`/admin/api/models?provider=${encodeURIComponent(provider)}`, options);
}

export async function saveModelCatalog(options: AdminApiOptions, provider: string, catalog: ProviderModelCatalog): Promise<ProviderModelCatalog> {
  const response = await adminFetch<{ ok: true; modelCatalog: ProviderModelCatalog }>(`/admin/api/models/${encodeURIComponent(provider)}`, options, {
    method: 'PUT',
    body: JSON.stringify(catalog),
  });
  return response.modelCatalog;
}

export async function triggerRuntimeReload(options: AdminApiOptions): Promise<void> {
  await adminFetch<{ ok: true; runtime: unknown }>('/admin/api/runtime/reload', options, { method: 'POST' });
}

export async function fetchDiagnostics(options: AdminApiOptions): Promise<DiagnosticsSnapshot> {
  return adminFetch<DiagnosticsSnapshot>('/admin/api/diagnostics', options);
}

export async function updateDiagnostics(
  options: AdminApiOptions,
  patch: { debugMode?: boolean; logToFile?: boolean },
): Promise<DiagnosticsSnapshot> {
  return adminFetch<DiagnosticsSnapshot>('/admin/api/diagnostics', options, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function fetchApiLogs(
  options: AdminApiOptions,
  query: {
    limit?: number;
    statusClass?: string;
    routeFamily?: string;
    method?: string;
    search?: string;
  } = {},
): Promise<{ entries: ApiCallLogEntry[] }> {
  const params = new URLSearchParams();
  if (query.limit) params.set('limit', String(query.limit));
  if (query.statusClass) params.set('statusClass', query.statusClass);
  if (query.routeFamily) params.set('routeFamily', query.routeFamily);
  if (query.method) params.set('method', query.method);
  if (query.search) params.set('search', query.search);
  const qs = params.toString();
  return adminFetch<{ entries: ApiCallLogEntry[] }>(`/admin/api/logs${qs ? `?${qs}` : ''}`, options);
}

export async function clearApiLogs(options: AdminApiOptions): Promise<{ ok: true; cleared: true }> {
  return adminFetch<{ ok: true; cleared: true }>('/admin/api/logs', options, { method: 'DELETE' });
}

export function mapApiCallLogEntryToRow(entry: ApiCallLogEntry): import('@/types/admin').ApiLogRow {
  const time = (() => {
    try {
      return new Date(entry.timestamp).toLocaleTimeString();
    } catch {
      return entry.timestamp;
    }
  })();
  return {
    id: entry.id,
    time,
    timestamp: entry.timestamp,
    routeFamily: entry.routeFamily,
    operation: entry.operation,
    model: entry.model ?? '—',
    gatewayKey: entry.gatewayKeyPreview ?? '—',
    upstreamTarget: entry.upstreamTarget ?? '—',
    latencyMs: entry.latencyMs,
    status: entry.statusClass,
    method: entry.method,
    path: entry.path,
    requestId: entry.requestId,
  };
}
