import type { ComponentType } from 'react';
import { BarChart3, KeyRound, ListTree, Settings2, Shield, Terminal, type LucideProps } from 'lucide-react';
import type { AdminViewId } from '@/types/admin';

export interface AdminNavItem {
  readonly id: AdminViewId;
  readonly label: string;
  readonly description: string;
  readonly icon: ComponentType<LucideProps>;
}

export const adminNavItems: readonly AdminNavItem[] = [
  { id: 'dashboard', label: 'Bảng điều khiển', description: 'Runtime posture', icon: BarChart3 },
  { id: 'gateway-keys', label: 'Quản lý Key', description: 'Client to Gateway credentials', icon: KeyRound },
  { id: 'auth-files', label: 'Vertex Auth', description: 'Gateway to Google credentials', icon: Terminal },
  { id: 'logs-viewer', label: 'Nhật ký API', description: 'Telemetry beta', icon: ListTree },
  { id: 'ai-providers', label: 'Cấu hình', description: 'Routing and targets', icon: Settings2 },
  { id: 'model-management', label: 'Bảo mật', description: 'Model policy controls', icon: Shield },
  { id: 'available-models', label: 'Model Catalog', description: 'Read-only inventory', icon: ListTree },
];

export const securityNotices = [
  'Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.',
  'Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client.',
  'Wildcard CORS không phù hợp cho production.',
] as const;
