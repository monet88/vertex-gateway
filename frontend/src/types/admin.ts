export type AdminViewId =
  | 'dashboard'
  | 'gateway-keys'
  | 'ai-providers'
  | 'auth-files'
  | 'available-models'
  | 'logs-viewer'
  | 'model-management';

export type AdminStoreMode = 'static-config' | 'file-store';
export type VertexHealth = 'ready' | 'degraded' | 'failed' | 'disabled' | 'unknown';
export type VertexApiKeyMode = 'full' | 'express';
export type VertexPoolSelection = 'round-robin' | 'bind-first';

export interface GatewayKeyRow {
  readonly id: string;
  readonly label: string;
  readonly preview: string;
  readonly secret?: string;
  readonly status: 'active' | 'revoked';
  readonly createdAt: string;
  readonly revokedAt?: string;
}

export interface VertexTargetRow {
  readonly id: string;
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly authType: 'Agent Platform API key' | 'Service Account JSON';
  readonly apiKeyMode: VertexApiKeyMode;
  readonly enabled: boolean;
  readonly weight: number;
  readonly modelAllowlist: readonly string[];
  readonly modelExclusions: readonly string[];
  readonly credentialsFile: string | null;
  readonly hasApiKey: boolean;
  readonly email?: string;
  readonly health: VertexHealth;
}

export interface RuntimeHealthSummary {
  readonly ok: boolean;
  readonly service: string;
  readonly mode: AdminStoreMode;
  readonly runtimeMode: string;
  readonly selection: VertexPoolSelection;
  readonly targetCount: number;
  readonly healthyTargets: number;
  readonly degradedTargets: number;
}

export interface ProviderModelCatalog {
  readonly defaultModel?: string;
  readonly aliases: Record<string, string>;
  readonly allowlist: readonly string[];
  readonly disabled: readonly string[];
}

export interface AdminScopedError {
  readonly area: string;
  readonly message: string;
}

export type ApiCallStatusClass = '2xx' | '4xx' | '5xx';
export type RouteFamily = 'gemini' | 'openai';

export interface DiagnosticsSnapshot {
  readonly debugMode: boolean;
  readonly logToFile: boolean;
  readonly gateEnabled: boolean;
  readonly writable: boolean;
  readonly logFilePath?: string | null;
  readonly ringSize: number;
  readonly entryCount: number;
}

export interface ApiCallLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly statusClass: ApiCallStatusClass;
  readonly latencyMs: number;
  readonly routeFamily: string;
  readonly operation: string;
  readonly model?: string;
  readonly gatewayKeyPreview?: string | null;
  readonly upstreamTarget?: string | null;
  readonly errorCode?: string | null;
}

/** Table-friendly projection used by ApiLogsTable. */
export interface ApiLogRow {
  readonly id: string;
  /** Display-only local time string. */
  readonly time: string;
  /** ISO timestamp used for chronological sorting. */
  readonly timestamp: string;
  readonly routeFamily: RouteFamily | string;
  readonly operation: string;
  readonly model: string;
  readonly gatewayKey: string;
  readonly upstreamTarget: string;
  readonly latencyMs: number;
  readonly status: ApiCallStatusClass;
  readonly method?: string;
  readonly path?: string;
  readonly requestId?: string;
}
