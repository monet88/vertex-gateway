import type { GatewayKeyRow } from '@/types/admin';

export const insertCreatedGatewayKey = (
  currentRows: readonly GatewayKeyRow[],
  gatewayKey: GatewayKeyRow,
  secret: string,
): readonly GatewayKeyRow[] => [
  { ...gatewayKey, secret },
  ...currentRows.filter((row) => row.id !== gatewayKey.id),
];

export const mergeGatewayKeySecrets = (
  nextRows: readonly GatewayKeyRow[],
  currentRows: readonly GatewayKeyRow[],
): readonly GatewayKeyRow[] => {
  const secretsById = new Map(
    currentRows
      .filter((row) => row.secret)
      .map((row) => [row.id, row.secret] as const),
  );

  return nextRows.map((row) => {
    const secret = secretsById.get(row.id);
    return secret ? { ...row, secret } : row;
  });
};