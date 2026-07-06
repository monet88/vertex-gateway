import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'changeme';
export const MIN_ADMIN_PASSWORD_LENGTH = 8;

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

export const hashAdminPassword = (password: string): string => {
  const salt = randomBytes(16).toString('base64url');
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS).toString('base64url');
  return `scrypt:v1:${salt}:${derived}`;
};

export const verifyAdminPassword = (password: string, storedHash: string): boolean => {
  const [algorithm, version, salt, expected] = storedHash.split(':');
  if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !expected) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'base64url');
  const actualBuffer = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const isValidNewAdminPassword = (password: string): boolean =>
  password.length >= MIN_ADMIN_PASSWORD_LENGTH && password !== DEFAULT_ADMIN_PASSWORD;
