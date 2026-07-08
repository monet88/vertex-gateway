export type AdminViewId =
  | 'dashboard'
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
