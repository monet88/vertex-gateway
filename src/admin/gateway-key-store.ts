import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayConfig } from '../config/env.js';
import {
  createDerivedConfig,
  hasAlignedGatewayKeyDigests,
  hashGatewayKeyDigests,
} from '../config/env.js';
import { GatewayError } from '../http/error-response.js';
import { readJsonIfExists, writeJsonAtomic } from '../lib/json-file-store.js';

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

export interface DeletedGatewayKey {
  gatewayKey: SanitizedGatewayKeyRecord;
}

export interface GatewayKeyStore {
  getSnapshot(): GatewayKeySnapshot;
  getActiveHashes(): string[];
  create(input: { label?: string }): CreatedGatewayKey;
  revoke(id: string): RevokedGatewayKey;
  delete(id: string): DeletedGatewayKey;
}

const STORE_FILE = 'gateway-keys.json';

export const hashGatewayKey = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

const createSecret = (): string =>
  `vgw_${randomBytes(24).toString('base64url')}`;

const previewSecret = (secret: string): string => {
  if (secret.length >= 16) return `${secret.slice(0, 8)}...${secret.slice(-4)}`;
  if (secret.length <= 4) return `${'*'.repeat(Math.max(secret.length, 1))}...`;
  return `${secret.slice(0, 4)}...`;
};

const sanitize = ({ hash: _hash, ...record }: AdminGatewayKeyRecord): SanitizedGatewayKeyRecord =>
  record;

export const verifyManagedGatewayKey = (
  candidate: string,
  hashes: readonly string[],
): boolean => {
  if (hashes.length === 0) return false;
  const candidateHash = Buffer.from(hashGatewayKey(candidate), 'hex');
  let matched = false;
  for (const hash of hashes) {
    const stored = Buffer.from(hash, 'hex');
    if (candidateHash.length === stored.length && timingSafeEqual(candidateHash, stored)) {
      matched = true;
    }
  }
  return matched;
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
      delete: () => {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin store is read-only in static-config mode.');
      },
    };
  }

  const storeDir = config.adminFileStoreDir;
  const storePath = path.join(storeDir, STORE_FILE);

  const readRecords = (): AdminGatewayKeyRecord[] =>
    readJsonIfExists<AdminGatewayKeyRecord[]>(storePath) ?? [];

  const writeRecords = (records: AdminGatewayKeyRecord[]): void => {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
    writeJsonAtomic(storePath, records);
  };

  const restoreRecords = (records: AdminGatewayKeyRecord[] | null): void => {
    if (records) {
      writeRecords(records);
      return;
    }
    if (fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  };

  const tryRestoreRecords = (records: AdminGatewayKeyRecord[] | null): void => {
    try {
      restoreRecords(records);
    } catch {
      // Rollback is best-effort; keep the original persistence/reload error.
    }
  };

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
      const previousRecords = readJsonIfExists<AdminGatewayKeyRecord[]>(storePath);
      const records = previousRecords ? previousRecords.map((entry) => ({ ...entry })) : [];
      records.push(record);
      try {
        writeRecords(records);
        deriveAndNotify(records);
      } catch (error) {
        tryRestoreRecords(previousRecords);
        throw error;
      }
      return { gatewayKey: sanitize(record), secret };
    },

    revoke(id: string): RevokedGatewayKey {
      assertWritableMode(config);
      const previousRecords = readJsonIfExists<AdminGatewayKeyRecord[]>(storePath);
      const records = previousRecords ? previousRecords.map((entry) => ({ ...entry })) : [];
      const record = records.find((r) => r.id === id);
      if (!record) {
        throw new GatewayError(404, 'NOT_FOUND', `Gateway key ${id} not found.`);
      }
      record.status = 'revoked';
      record.revokedAt = new Date().toISOString();
      try {
        writeRecords(records);
        deriveAndNotify(records);
      } catch (error) {
        tryRestoreRecords(previousRecords);
        throw error;
      }
      return { gatewayKey: sanitize(record) };
    },

    delete(id: string): DeletedGatewayKey {
      assertWritableMode(config);
      const previousRecords = readJsonIfExists<AdminGatewayKeyRecord[]>(storePath);
      const records = previousRecords ? previousRecords.map((entry) => ({ ...entry })) : [];
      const recordIndex = records.findIndex((r) => r.id === id);
      if (recordIndex === -1) {
        throw new GatewayError(404, 'NOT_FOUND', `Gateway key ${id} not found.`);
      }
      const [deleted] = records.splice(recordIndex, 1);
      try {
        writeRecords(records);
        deriveAndNotify(records);
      } catch (error) {
        tryRestoreRecords(previousRecords);
        throw error;
      }
      return { gatewayKey: sanitize(deleted) };
    },
  };
};

/**
 * Hydrate managed gateway key hashes from the file store into the config.
 * Called at startup to ensure active managed keys are recognized by auth.
 */
const withGatewayKeyDigests = (config: GatewayConfig): GatewayConfig => {
  if (hasAlignedGatewayKeyDigests(config.gatewayKeys, config.gatewayKeyDigests)) {
    return config;
  }
  return {
    ...config,
    gatewayKeyDigests: hashGatewayKeyDigests(config.gatewayKeys ?? []),
  };
};

/**
 * Hydrate managed gateway key hashes from the file store (when present) and
 * ensure static gatewayKeyDigests are populated for O(1)-hash auth compares.
 * Avoid full createDerivedConfig when only digests are missing so partial test
 * fixtures without pool apiKeyMode keep working.
 */
export const hydrateManagedGatewayKeyHashes = (config: GatewayConfig): GatewayConfig => {
  const base = withGatewayKeyDigests(config);
  if (base.adminStoreMode !== 'file-store' || !base.adminFileStoreDir) {
    return base;
  }
  const storePath = path.join(base.adminFileStoreDir, STORE_FILE);
  const records = readJsonIfExists<AdminGatewayKeyRecord[]>(storePath) ?? [];
  const activeHashes = records
    .filter((r) => r.status === 'active')
    .map((r) => r.hash);
  if (activeHashes.length === 0) return base;
  return createDerivedConfig(base, { managedGatewayKeyHashes: activeHashes });
};
