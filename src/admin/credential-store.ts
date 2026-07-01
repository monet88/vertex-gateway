import fs from 'node:fs';
import path from 'node:path';
import type {
  GatewayConfig,
  ProviderModelCatalog,
  VertexPoolConfig,
} from '../config/env.js';
import { createDerivedConfig } from '../config/env.js';
import { loadServiceAccountCredential, type ServiceAccountCredential } from '../auth/google-auth.js';
import { GatewayError } from '../http/error-response.js';

export interface AdminVertexCredentialRecord extends VertexPoolConfig {
  email?: string;
  fileName?: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

interface FileStoreState {
  vertexPools: VertexPoolConfig[];
  modelCatalog: Record<string, ProviderModelCatalog>;
}

export interface AdminCredentialStoreSnapshot {
  mode: GatewayConfig['adminStoreMode'];
  mutable: boolean;
  vertexPools: AdminVertexCredentialRecord[];
  modelCatalog: Record<string, ProviderModelCatalog>;
}

export interface AdminCredentialStore {
  getSnapshot(): AdminCredentialStoreSnapshot;
  updateVertexPools(
    mutate: (state: AdminCredentialStoreSnapshot) => AdminCredentialStoreSnapshot,
  ): AdminCredentialStoreSnapshot;
}

export interface ImportedCredentialRecord {
  credential: AdminVertexCredentialRecord;
  rollback(): void;
}

const STORE_FILE = 'store.json';
const CREDENTIALS_DIR = 'credentials';

const cloneModelCatalog = (
  modelCatalog: Record<string, ProviderModelCatalog>,
): Record<string, ProviderModelCatalog> => Object.fromEntries(
  Object.entries(modelCatalog).map(([provider, config]) => [
    provider,
    {
      ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
      aliases: { ...config.aliases },
      allowlist: [...config.allowlist],
      disabled: [...config.disabled],
    },
  ]),
);

const cloneVertexPools = (vertexPools: VertexPoolConfig[]): VertexPoolConfig[] =>
  vertexPools.map((entry) => ({
    ...entry,
    modelAllowlist: [...entry.modelAllowlist],
    modelExclusions: [...entry.modelExclusions],
  }));

const toRecord = (entry: VertexPoolConfig): AdminVertexCredentialRecord => {
  const credential = loadServiceAccountCredential(entry.credentialsFile);
  const fileStats = entry.credentialsFile && fs.existsSync(entry.credentialsFile)
    ? fs.statSync(entry.credentialsFile)
    : null;
  return {
    ...entry,
    ...(credential ? { email: credential.client_email } : {}),
    ...(entry.credentialsFile ? { fileName: path.basename(entry.credentialsFile) } : {}),
    ...(fileStats ? { sizeBytes: fileStats.size, modifiedAt: fileStats.mtime.toISOString() } : {}),
  };
};

export const sanitizeCredentialId = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

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

const ensureJsonObject = (value: unknown, field: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', `${field} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
};

const credentialStateToRuntimePools = (state: AdminCredentialStoreSnapshot): VertexPoolConfig[] =>
  cloneVertexPools(state.vertexPools.map(({ email: _email, ...entry }) => entry));

const storeStateToConfig = (
  config: GatewayConfig,
  state: AdminCredentialStoreSnapshot,
): GatewayConfig => createDerivedConfig(config, {
  vertexPools: credentialStateToRuntimePools(state),
  modelCatalog: cloneModelCatalog(state.modelCatalog),
});

const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

const ensureStoreDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dir, CREDENTIALS_DIR), { recursive: true, mode: 0o700 });
};

const credentialsFileForId = (dir: string, id: string): string =>
  path.join(dir, CREDENTIALS_DIR, `${id}.json`);

const writeJsonAtomic = (filePath: string, value: unknown): void => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
};

const readFileStoreSnapshot = (config: GatewayConfig): AdminCredentialStoreSnapshot => {
  const dir = config.adminFileStoreDir!;
  ensureStoreDir(dir);
  const storeState = readJsonIfExists<FileStoreState>(path.join(dir, STORE_FILE));
  if (!storeState) {
    return {
      mode: 'file-store',
      mutable: config.adminAllowMutations,
      vertexPools: config.vertexPools.map(toRecord),
      modelCatalog: cloneModelCatalog(config.modelCatalog),
    };
  }
  return {
    mode: 'file-store',
    mutable: config.adminAllowMutations,
    vertexPools: cloneVertexPools(storeState.vertexPools).map(toRecord),
    modelCatalog: cloneModelCatalog(storeState.modelCatalog),
  };
};

const persistFileStoreSnapshot = (
  config: GatewayConfig,
  state: AdminCredentialStoreSnapshot,
): void => {
  const dir = config.adminFileStoreDir!;
  ensureStoreDir(dir);
  const storeState: FileStoreState = {
    vertexPools: credentialStateToRuntimePools(state),
    modelCatalog: cloneModelCatalog(state.modelCatalog),
  };
  writeJsonAtomic(path.join(dir, STORE_FILE), storeState);
};

export const createCredentialStore = (
  config: GatewayConfig,
  onReload?: (nextConfig: GatewayConfig) => void,
): AdminCredentialStore => {
  const getSnapshot = (): AdminCredentialStoreSnapshot => {
    if (config.adminStoreMode === 'static-config') {
      return {
        mode: 'static-config',
        mutable: false,
        vertexPools: config.vertexPools.map(toRecord),
        modelCatalog: cloneModelCatalog(config.modelCatalog),
      };
    }
    return readFileStoreSnapshot(config);
  };

  return {
    getSnapshot,
    updateVertexPools: (mutate) => {
      const previous = getSnapshot();
      const next = mutate({
        mode: previous.mode,
        mutable: previous.mutable,
        vertexPools: previous.vertexPools.map((entry) => ({ ...entry })),
        modelCatalog: cloneModelCatalog(previous.modelCatalog),
      });
      if (next.mode === 'file-store') {
        assertWritableMode(config);
        const backupStore = readJsonIfExists<FileStoreState>(path.join(config.adminFileStoreDir!, STORE_FILE));
        try {
          persistFileStoreSnapshot(config, next);
          onReload?.(storeStateToConfig(config, next));
          return getSnapshot();
        } catch (error) {
          if (backupStore) {
            writeJsonAtomic(path.join(config.adminFileStoreDir!, STORE_FILE), backupStore);
          } else if (config.adminFileStoreDir) {
            const storeFile = path.join(config.adminFileStoreDir, STORE_FILE);
            if (fs.existsSync(storeFile)) {
              fs.rmSync(storeFile);
            }
          }
          throw error;
        }
      }
      throw new GatewayError(400, 'VALIDATION_FAILED', 'Admin store is read-only in static-config mode.');
    },
  };
};

export const importServiceAccountCredential = (
  config: GatewayConfig,
  body: Record<string, unknown>,
): ImportedCredentialRecord => {
  assertWritableMode(config);
  ensureStoreDir(config.adminFileStoreDir!);
  const credentialBody = ensureJsonObject(body.credential, 'credential');
  if (credentialBody.installed || credentialBody.web) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OAuth client JSON is not supported.');
  }
  const project = typeof body.project === 'string' ? body.project.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  if (!project || !location) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'project and location are required.');
  }
  const serviceAccount = credentialBody as unknown as ServiceAccountCredential;
  if (serviceAccount.type !== 'service_account') {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'credential type must be service_account.');
  }
  if (serviceAccount.project_id !== project) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'credential project_id must match the target project.');
  }
  if (typeof serviceAccount.client_email !== 'string' || !serviceAccount.client_email.trim()) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'credential client_email is required.');
  }
  if (typeof serviceAccount.private_key !== 'string' || !serviceAccount.private_key.trim()) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'credential private_key is required.');
  }
  const id = sanitizeCredentialId(`${project}-${serviceAccount.client_email}`);
  const credentialsFile = credentialsFileForId(config.adminFileStoreDir!, id);
  const replace = body.replace === true;
  const previousCredential = fs.existsSync(credentialsFile)
    ? fs.readFileSync(credentialsFile)
    : null;
  if (!replace && fs.existsSync(credentialsFile)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', `Credential ${id} already exists. Use replace=true to overwrite.`);
  }
  writeJsonAtomic(credentialsFile, credentialBody);
  return {
    credential: {
      id,
      label: typeof body.label === 'string' ? body.label.trim() || undefined : undefined,
      project,
      location,
      credentialsFile,
      enabled: body.enabled !== false,
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
      modelAllowlist: Array.isArray(body.modelAllowlist)
        ? body.modelAllowlist.filter((value): value is string => typeof value === 'string')
        : [],
      modelExclusions: Array.isArray(body.modelExclusions)
        ? body.modelExclusions.filter((value): value is string => typeof value === 'string')
        : [],
      email: serviceAccount.client_email,
    },
    rollback: () => {
      if (previousCredential) {
        fs.writeFileSync(credentialsFile, previousCredential, { mode: 0o600 });
        return;
      }
      if (fs.existsSync(credentialsFile)) {
        fs.rmSync(credentialsFile);
      }
    },
  };
};
