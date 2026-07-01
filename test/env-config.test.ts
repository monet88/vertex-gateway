import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const ORIGINAL_ENV = { ...process.env };

const writeCredentialFile = (dir: string, name: string, project = 'service-project') => {
  const credentialPath = path.join(dir, name);
  fs.writeFileSync(credentialPath, JSON.stringify({
    type: 'service_account',
    project_id: project,
    client_email: `${name}@example.test`,
    private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
  }));
  return credentialPath;
};

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
});

describe('gateway config file', () => {
  it('loads config from GATEWAY_CONFIG_FILE when env vars are absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'port: 19087',
      'gatewayKeys:',
      '  - test-gateway-key',
      'corsOrigins:',
      '  - http://localhost:3000',
      'googleProject: project-b82b6a5a-13c8-42e4-a56',
      'googleCredentialsFile: null',
      'googleLocation: global',
      'enableGeminiRoutes: true',
      'enableVertexRoutes: true',
      'enableVtxRoutes: true',
      'enableImageRoutes: true',
    ].join('\n'));

    delete process.env.PORT;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GATEWAY_CORS_ORIGINS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    process.env.GATEWAY_CONFIG_FILE = configPath;

    const config = loadConfig();
    expect(config.port).toBe(19087);
    expect(config.gatewayKeys).toEqual(['test-gateway-key']);
    expect(config.corsOrigins).toEqual(['http://localhost:3000']);
    expect(config.googleProject).toBe('project-b82b6a5a-13c8-42e4-a56');
    expect(config.googleCredentialsFile).toBeNull();
    expect(config.googleLocation).toBe('global');
  });

  it('lets env vars override file config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - from-file',
      'googleProject: from-file-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_API_KEYS = 'from-env';
    process.env.GOOGLE_VERTEX_PROJECT = 'from-env-project';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();
    expect(config.gatewayKeys).toEqual(['from-env']);
    expect(config.googleProject).toBe('from-env-project');
  });

  it('applies vertexPoolFailoverCooldownMs from GATEWAY_CONFIG_FILE when env and pool overlay are absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - from-file',
      'googleProject: from-file-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
      'vertexPoolFailoverCooldownMs: 15000',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_POOL_CONFIG_FILE;
    delete process.env.GATEWAY_VERTEX_POOL_FAILOVER_COOLDOWN_MS;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();

    expect(config.vertexPoolFailoverCooldownMs).toBe(15000);
  });

  it('keeps hash characters inside quoted YAML scalar values', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - "monet#4292"',
      'googleProject: "project#hash"',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();
    expect(config.gatewayKeys).toEqual(['monet#4292']);
    expect(config.googleProject).toBe('project#hash');
  });

  it('loads JSON config files without YAML parsing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      gatewayKeys: ['json#key'],
      googleProject: 'json-project',
      googleCredentialsFile: null,
      googleLocation: 'global',
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();
    expect(config.gatewayKeys).toEqual(['json#key']);
    expect(config.googleProject).toBe('json-project');
  });

  it('strips comments after quoted YAML values ending with an escaped backslash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - test-key',
      'googleProject: "project\\\\\\\\" # inline comment',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();
    expect(config.googleProject).toBe('project\\\\');
  });

  it('strips comments after single-quoted YAML values ending with a backslash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - test-key',
      "googleProject: 'project\\' # inline comment",
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();
    expect(config.googleProject).toBe('project\\');
  });

  it('rejects malformed JSON config field types before runtime auth checks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      gatewayKeys: 'not-a-list',
      googleProject: 123,
      googleCredentialsFile: null,
      googleLocation: 'global',
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/gatewayKeys must be a string array/);
  });

  it('loads vertex pool overlay config from GATEWAY_POOL_CONFIG_FILE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');
    const credentialsFile = writeCredentialFile(dir, 'vertex-a.json', 'pool-project-a');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      vertexPoolSelection: 'round-robin',
      enableAdminRoutes: true,
      adminToken: 'admin-secret',
      adminStoreMode: 'file-store',
      adminFileStoreDir: '/data/auths',
      modelCatalog: {
        gemini: {
          defaultModel: 'gemini-2.5-flash',
          aliases: { fast: 'gemini-2.5-flash' },
          allowlist: ['gemini-2.5-flash'],
          disabled: [],
        },
      },
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          credentialsFile,
          enabled: true,
          weight: 1,
        },
        {
          id: 'project-b',
          project: 'pool-project-b',
          location: 'us-central1',
          enabled: false,
          weight: 2,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GATEWAY_ENABLE_ADMIN_ROUTES;
    delete process.env.GATEWAY_ADMIN_TOKEN;

    const config = loadConfig();

    expect(config.runtimeMode).toBe('pool');
    expect(config.vertexPoolSelection).toBe('round-robin');
    expect(config.vertexPools).toHaveLength(2);
    expect(config.resolvedVertexTargets).toEqual([
      expect.objectContaining({
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        source: 'pool',
      }),
    ]);
    expect(config.enableAdminRoutes).toBe(true);
    expect(config.adminToken).toBe('admin-secret');
    expect(config.adminStoreMode).toBe('file-store');
    expect(config.adminFileStoreDir).toBe('/data/auths');
    expect(config.modelCatalog.gemini).toEqual({
      defaultModel: 'gemini-2.5-flash',
      aliases: { fast: 'gemini-2.5-flash' },
      allowlist: ['gemini-2.5-flash'],
      disabled: [],
    });
  });

  it('keeps single-target fallback when no vertex pool overlay is configured', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_POOL_CONFIG_FILE;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    const config = loadConfig();

    expect(config.runtimeMode).toBe('single');
    expect(config.vertexPools).toEqual([]);
    expect(config.resolvedVertexTargets).toEqual([
      expect.objectContaining({
        id: 'legacy-default',
        project: 'fallback-project',
        source: 'legacy',
      }),
    ]);
  });

  it('rejects nested pool keys inside GATEWAY_CONFIG_FILE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      gatewayKeys: ['gateway-key'],
      googleProject: 'json-project',
      googleCredentialsFile: null,
      googleLocation: 'global',
      vertexPools: [],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/vertexPools must be configured via GATEWAY_POOL_CONFIG_FILE/);
  });

  it('fails when a pool overlay leaves no enabled targets', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          enabled: false,
          weight: 1,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/At least one enabled vertex pool target is required/);
  });

  it('fails when Cloud Run tries to enable mutable file-store admin mode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');
    const credentialsFile = writeCredentialFile(dir, 'vertex-a.json', 'pool-project-a');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - gateway-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      adminAllowMutations: true,
      adminStoreMode: 'file-store',
      adminFileStoreDir: '/data/auths',
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          credentialsFile,
          enabled: true,
          weight: 1,
        },
      ],
    }));

    process.env.K_SERVICE = 'chang-store-vertex-gateway';
    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/Cloud Run does not support admin file-store mutations/);
  });

  it('fails when admin token overlaps a public gateway key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-'));
    const configPath = path.join(dir, 'config.yaml');
    const poolPath = path.join(dir, 'pool.json');
    const credentialsFile = writeCredentialFile(dir, 'vertex-a.json', 'pool-project-a');

    fs.writeFileSync(configPath, [
      'gatewayKeys:',
      '  - overlap-key',
      'googleProject: fallback-project',
      'googleCredentialsFile: null',
      'googleLocation: global',
    ].join('\n'));
    fs.writeFileSync(poolPath, JSON.stringify({
      enableAdminRoutes: true,
      adminToken: 'overlap-key',
      vertexPools: [
        {
          id: 'project-a',
          project: 'pool-project-a',
          location: 'global',
          credentialsFile,
          enabled: true,
          weight: 1,
        },
      ],
    }));

    process.env.GATEWAY_CONFIG_FILE = configPath;
    process.env.GATEWAY_POOL_CONFIG_FILE = poolPath;
    delete process.env.GATEWAY_API_KEYS;
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.GOOGLE_VERTEX_LOCATION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    expect(() => loadConfig()).toThrow(/must not overlap/);
  });
});
