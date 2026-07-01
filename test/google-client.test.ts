import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getGoogleAuthStatus, loadServiceAccountCredential } from '../src/auth/google-auth.js';
import { testConfig } from './test-config.js';

describe('google auth status', () => {
  const writeCredential = (body: Record<string, unknown>) => {
    const dir = join(tmpdir(), `chang-store-gateway-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'vertex-account.json');
    writeFileSync(file, JSON.stringify(body));
    return file;
  };

  it('keeps browser gateway auth separate from Google server auth', () => {
    const credentialFile = writeCredential({
      type: 'service_account',
      project_id: 'service-project',
      client_email: 'svc@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    });

    expect(getGoogleAuthStatus(testConfig({
      gatewayKeys: ['browser-facing-gateway-key'],
      googleCredentialsFile: credentialFile,
    }))).toEqual({
      mode: 'serviceAccountJson',
      project: 'service-project',
      location: 'us-central1',
      apiVersion: 'v1',
      hasGoogleCredentialsFile: true,
      email: 'svc@example.test',
    });
  });

  it('returns pool auth summary without leaking per-target credentials', () => {
    expect(getGoogleAuthStatus(testConfig({
      runtimeMode: 'pool',
      vertexPoolSelection: 'round-robin',
      vertexPools: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: '/run/secrets/project-a.json',
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
        },
        {
          id: 'project-b',
          project: 'project-b',
          location: 'us-central1',
          credentialsFile: null,
          enabled: false,
          weight: 1,
          label: 'Project B',
          modelAllowlist: [],
          modelExclusions: [],
        },
      ],
      resolvedVertexTargets: [
        {
          id: 'project-a',
          project: 'project-a',
          location: 'global',
          credentialsFile: '/run/secrets/project-a.json',
          enabled: true,
          weight: 1,
          label: 'Project A',
          modelAllowlist: [],
          modelExclusions: [],
          source: 'pool',
        },
      ],
    }))).toEqual({
      mode: 'pool',
      apiVersion: 'v1',
      selection: 'round-robin',
      configuredTargets: 2,
      enabledTargets: 1,
      credentialFileTargets: 1,
    });
  });

  it('reloads service account credentials when the file is rotated', () => {
    const credentialFile = writeCredential({
      type: 'service_account',
      project_id: 'service-project',
      client_email: 'svc@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    });

    expect(loadServiceAccountCredential(credentialFile)?.client_email).toBe('svc@example.test');
    writeFileSync(credentialFile, JSON.stringify({
      type: 'service_account',
      project_id: 'rotated-project',
      client_email: 'rotated@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\nrotated\n-----END PRIVATE KEY-----\n',
    }));

    expect(loadServiceAccountCredential(credentialFile)).toMatchObject({
      project_id: 'rotated-project',
      client_email: 'rotated@example.test',
    });
  });

  it('does not mask invalid service account JSON after file rotation', () => {
    const credentialFile = writeCredential({
      type: 'service_account',
      project_id: 'service-project',
      client_email: 'svc@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    });

    expect(loadServiceAccountCredential(credentialFile)?.client_email).toBe('svc@example.test');
    writeFileSync(credentialFile, JSON.stringify({ installed: { client_id: 'oauth-client' } }));

    expect(() => loadServiceAccountCredential(credentialFile)).toThrow(/service account key/);
  });

  it('rejects OAuth client JSON because Vertex needs service account credentials', () => {
    const credentialFile = writeCredential({
      installed: {
        client_id: 'client-id',
        client_secret: 'client-secret',
      },
    });

    expect(() => loadServiceAccountCredential(credentialFile)).toThrow(/service account key/);
  });
});
