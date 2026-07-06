import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayConfig } from '../config/env.js';
import { createDerivedConfig } from '../config/env.js';
import { GatewayError } from '../http/error-response.js';

export type GatewayKeyStatus = 'active' | 'revoked';

export interface AdminGatewayKeyRecord {
  id: string;
  label: string;
  preview: string;
  status: GatewayKeyStatus;
  createdAt: string;
  revokedAt?: string;
  hash: string;
}

export type SanitizedGatewayKeyRecord = Omit<AdminGatewayKeyRecord, 'hash'>;

export interface GatewayKeySnapshot {
  mode: GatewayConfig['adminStoreMode'];
  mutable: boolean;
  gatewayKeys: SanitizedGatewayKeyRecord[];
}

export interface CreatedGatewayKey {
  gatewayKey: SanitizedGatewayKeyRecord;
  secret: string;
}

export interface RevokedGatewayKey {
  gatewayKey: SanitizedGatewayKeyRecord;
}

export interface GatewayKeyStore {
  getSnapshot(): GatewayKeySnapshot;
  getActiveHashes(): string[];
  create(input: { label?: string }): CreatedGatewayKey;
  revoke(id: string): RevokedGatewayKey;
}

const STORE_FILE = 'gateway-keys.json';

export const hashGatewayKey = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

const createSecret = (): string =>
  `vgw_${randomBytes(24).toString('base64url')}`;

const previewSecret = (secret: string): string =>
  secret.length >= 16
    ? `${secret.slice(0, 8)}...${secret.slice(-4)}`
    : `${secret.slice(0, 4)}...`;

const sanitize = ({ hash: _hash, ...record }: AdminGatewayKeyRecord): SanitizedGatewayKeyRecord =>
  record;

export const verifyManagedGatewayKey = (
  candidate: string,
  hashes: readonly string[],
): boolean => {
  if (hashes.length === 0) return false;
  const candidateHash = Buffer.from(hashGatewayKey(candidate), 'hex');
  return hashes.some((hash) => {
    const stored = Buffer.from(hash, 'hex');
    return candidateHash.length === stored.length && timingSafeEqual(candidateHash, stored);
  });
};

const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

const writeJsonAtomic = (filePath: string, value: unknown): void => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
};

const assertWritableMode = (config: GatewayConfig): void => {
  if (config.adminStoreMode === 'static-config') {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin store is read-only in static-config mode.');
  }
  if (!config.adminAllowMutations) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin mutations are disabled.');
  }
  if (!config.adminFileStoreDir) {
    throw new GatewayError(500, 'INTERNAL', 'Admin file store directory is not configured.');
  }
};

const staticConfigSnapshot = (config: GatewayConfig): GatewayKeySnapshot => {
  const gatewayKeys: SanitizedGatewayKeyRecord[] = config.gatewayKeys.map((key, index) => ({
    id: `config-key-${index}`,
    label: `Config key ${index + 1}`,
    preview: previewSecret(key),
    status: 'active' as const,
    createdAt: new Date(0).toISOString(),
  }));
  return { mode: 'static-config', mutable: false, gatewayKeys };
};

export const createGatewayKeyStore = (
  config: GatewayConfig,
  onConfigReload?: (nextConfig: GatewayConfig) => void,
): GatewayKeyStore => {
  if (config.adminStoreMode === 'static-config' || !config.adminFileStoreDir) {
    return {
      getSnapshot: () => staticConfigSnapshot(config),
      getActiveHashes: () => [],
      create: () => {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin store is read-only in static-config mode.');
      },
      revoke: () => {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin store is read-only in static-config mode.');
      },
    };
  }

  const storeDir = config.adminFileStoreDir;
  const storePath = path.join(storeDir, STORE_FILE);
  fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });

  const readRecords = (): AdminGatewayKeyRecord[] =>
    readJsonIfExists<AdminGatewayKeyRecord[]>(storePath) ?? [];

  const writeRecords = (records: AdminGatewayKeyRecord[]): void =>
    writeJsonAtomic(storePath, records);

  const deriveAndNotify = (records: AdminGatewayKeyRecord[]): void => {
    const activeHashes = records
      .filter((r) => r.status === 'active')
      .map((r) => r.hash);
    const nextConfig = createDerivedConfig(config, {
      managedGatewayKeyHashes: activeHashes,
    });
    onConfigReload?.(nextConfig);
  };

  return {
    getSnapshot(): GatewayKeySnapshot {
      const records = readRecords();
      return {
        mode: 'file-store',
        mutable: config.adminAllowMutations,
        gatewayKeys: records.map(sanitize),
      };
    },

    getActiveHashes(): string[] {
      return readRecords()
        .filter((r) => r.status === 'active')
        .map((r) => r.hash);
    },

    create(input: { label?: string }): CreatedGatewayKey {
      assertWritableMode(config);
      const secret = createSecret();
      const hash = hashGatewayKey(secret);
      const record: AdminGatewayKeyRecord = {
        id: randomBytes(8).toString('hex'),
        label: input.label ?? 'Managed key',
        preview: previewSecret(secret),
        status: 'active',
        createdAt: new Date().toISOString(),
        hash,
      };
      const records = readRecords();
      records.push(record);
      writeRecords(records);
      deriveAndNotify(records);
      return { gatewayKey: sanitize(record), secret };
    },

    revoke(id: string): RevokedGatewayKey {
      assertWritableMode(config);
      const records = readRecords();
      const record = records.find((r) => r.id === id);
      if (!record) {
        throw new GatewayError(404, 'NOT_FOUND', `Gateway key ${id} not found.`);
      }
      record.status = 'revoked';
      record.revokedAt = new Date().toISOString();
      writeRecords(records);
      deriveAndNotify(records);
      return { gatewayKey: sanitize(record) };
    },
  };
};

/**
 * Hydrate managed gateway key hashes from the file store into the config.
 * Called at startup to ensure active managed keys are recognized by auth.
 */
export const hydrateManagedGatewayKeyHashes = (config: GatewayConfig): GatewayConfig => {
  if (config.adminStoreMode !== 'file-store' || !config.adminFileStoreDir) {
    return config;
  }
  const storePath = path.join(config.adminFileStoreDir, STORE_FILE);
  const records = readJsonIfExists<AdminGatewayKeyRecord[]>(storePath) ?? [];
  const activeHashes = records
    .filter((r) => r.status === 'active')
    .map((r) => r.hash);
  if (activeHashes.length === 0) return config;
  return createDerivedConfig(config, { managedGatewayKeyHashes: activeHashes });
};
