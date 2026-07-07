import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

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

const scryptKey = async (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });

export const hashAdminPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await scryptKey(password, salt)).toString('base64url');
  return `scrypt:v1:${salt}:${derived}`;
};

export const verifyAdminPassword = async (password: string, storedHash: string): Promise<boolean> => {
  const [algorithm, version, salt, expected] = storedHash.split(':');
  if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !expected) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'base64url');
  const actualBuffer = await scryptKey(password, salt);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};

export const isValidNewAdminPassword = (password: string): boolean =>
  password.length >= MIN_ADMIN_PASSWORD_LENGTH && password !== DEFAULT_ADMIN_PASSWORD;
