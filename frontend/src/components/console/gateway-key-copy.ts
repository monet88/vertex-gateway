import type { GatewayKeyRow } from '@/types/admin';

export const getGatewayKeyCopyValue = (key: GatewayKeyRow): string | null =>
  key.secret ?? null;