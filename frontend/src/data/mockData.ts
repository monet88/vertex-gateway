export type RouteFamily = 'gemini' | 'openai' | 'vertex' | 'vtx' | 'custom';
export type LogStatus = '2xx' | '4xx' | '5xx';

export interface ApiLogRow {
  id: string;
  time: string;
  routeFamily: RouteFamily;
  operation: string;
  model: string;
  gatewayKey: string;
  upstreamTarget: string;
  latencyMs: number;
  status: LogStatus;
}

export interface GatewayKeyRow {
  id: string;
  label: string;
  preview: string;
  status: 'active' | 'revoked';
  createdAt: string;
}

export interface VertexTargetRow {
  id: string;
  label: string;
  project: string;
  location: string;
  authType: 'Google Cloud API key' | 'Service Account JSON';
  apiKeyMode: 'full' | 'express';
  health: 'ready' | 'degraded' | 'failed';
}

export const apiLogs: ApiLogRow[] = [
  {
    id: 'req-01jz7w8q4n',
    time: '14:32:08',
    routeFamily: 'gemini',
    operation: 'generateContent',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...q2a',
    upstreamTarget: 'global-primary',
    latencyMs: 842,
    status: '2xx',
  },
  {
    id: 'req-01jz7w91mf',
    time: '14:31:44',
    routeFamily: 'openai',
    operation: 'chatCompletions',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...9kp',
    upstreamTarget: 'asia-failover',
    latencyMs: 1290,
    status: '5xx',
  },
  {
    id: 'req-01jz7w9n7c',
    time: '14:30:12',
    routeFamily: 'vertex',
    operation: 'predict',
    model: 'gemini-3.1-flash-image-preview',
    gatewayKey: 'vgw_...p7m',
    upstreamTarget: 'image-global',
    latencyMs: 2110,
    status: '4xx',
  },
];

export const gatewayKeys: GatewayKeyRow[] = [
  { id: 'key-mobile', label: 'Mobile app', preview: 'vgw_...q2a', status: 'active', createdAt: '2026-07-05' },
  { id: 'key-console', label: 'Admin smoke test', preview: 'vgw_...9kp', status: 'revoked', createdAt: '2026-07-04' },
];

export const vertexTargets: VertexTargetRow[] = [
  {
    id: 'target-global-primary',
    label: 'Global primary',
    project: 'vertex-prod-a',
    location: 'global',
    authType: 'Google Cloud API key',
    apiKeyMode: 'full',
    health: 'ready',
  },
  {
    id: 'target-asia-failover',
    label: 'Asia failover',
    project: 'vertex-prod-b',
    location: 'asia-southeast1',
    authType: 'Service Account JSON',
    apiKeyMode: 'full',
    health: 'degraded',
  },
];

export const kpiMetrics = [
  {
    id: 'kpi-requests',
    label: 'Requests 24h',
    value: '84.2k',
    trendIcon: 'trending_up',
    trendValue: '+12%',
    colorScheme: 'primary' as const,
  },
  {
    id: 'kpi-error',
    label: 'Error rate',
    value: '0.04%',
    trendIcon: 'trending_flat',
    trendValue: '0.00%',
    colorScheme: 'error' as const,
  },
  {
    id: 'kpi-keys',
    label: 'Active Gateway Keys',
    value: '12',
    icon: 'key',
    colorScheme: 'primary' as const,
  },
  {
    id: 'kpi-targets',
    label: 'Vertex Targets',
    value: '4',
    icon: 'dns',
    colorScheme: 'secondary' as const,
  },
];

export const securityNotices = [
  {
    id: 'notice-1',
    message: 'Token admin tách biệt với gateway key',
    type: 'info' as const,
    icon: 'info',
  },
  {
    id: 'notice-2',
    message: 'Không dùng wildcard CORS trong production',
    type: 'error' as const,
    icon: 'error',
  },
  {
    id: 'notice-3',
    message: 'File-store mutations bị vô hiệu hóa trên Cloud Run',
    type: 'warning' as const,
    icon: 'lock',
  },
];
