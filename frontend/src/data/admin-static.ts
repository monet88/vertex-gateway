import type { AdminViewId } from '@/types/admin';

export interface AdminNavItem {
  readonly id: AdminViewId;
  readonly label: string;
  readonly description: string;
}

export const adminNavItems: readonly AdminNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', description: 'Runtime posture' },
  { id: 'ai-providers', label: 'AI Providers', description: 'Vertex targets' },
  { id: 'auth-files', label: 'Auth Files', description: 'Upstream credentials' },
  { id: 'available-models', label: 'Available Models', description: 'Catalog inventory' },
  { id: 'logs-viewer', label: 'Logs Viewer', description: 'Telemetry beta' },
  { id: 'model-management', label: 'Model Management', description: 'Routing policy' },
];

export const securityNotices = [
  'Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.',
  'Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client.',
  'Wildcard CORS không phù hợp cho production.',
] as const;
