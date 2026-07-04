import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testConfig } from './test-config.js';

const { googleGenAiMock, createVertexRestClientMock } = vi.hoisted(() => ({
  googleGenAiMock: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: vi.fn() } };
  }),
  createVertexRestClientMock: vi.fn(() => ({ models: { generateContent: vi.fn() } })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAiMock,
}));

vi.mock('../src/lib/vertex-rest-client.js', () => ({
  createVertexRestClient: createVertexRestClientMock,
}));

describe('Google GenAI client', () => {
  beforeEach(() => {
    googleGenAiMock.mockClear();
    createVertexRestClientMock.mockClear();
  });

  it('uses the gateway upstream timeout as the SDK HTTP timeout', async () => {
    const { createGoogleGenAiClient } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClient(testConfig({ upstreamTimeoutMs: 12345 }));

    expect(googleGenAiMock).toHaveBeenCalledWith(expect.objectContaining({
      httpOptions: { timeout: 12345 },
    }));
  });

  it('builds a target-scoped SDK client from the resolved pool target', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig({ googleApiVersion: 'v1beta', upstreamTimeoutMs: 45678 }),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: null,
        apiKeyMode: 'full',
        enabled: true,
        weight: 2,
        label: 'Project A',
        modelAllowlist: [],
        modelExclusions: [],
        source: 'pool',
      },
    );

    expect(googleGenAiMock).toHaveBeenLastCalledWith(expect.objectContaining({
      project: 'pool-project-a',
      location: 'global',
      apiVersion: 'v1beta',
      httpOptions: { timeout: 45678 },
    }));
  });

  it('uses the REST client for full api-key targets and skips SDK initialization', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig({ googleApiVersion: 'v1', upstreamTimeoutMs: 45678 }),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: 'AIzafull-mode-test-key',
        apiKeyMode: 'full',
        enabled: true,
        weight: 2,
        label: 'Project A',
        modelAllowlist: [],
        modelExclusions: [],
        source: 'pool',
      },
    );

    expect(createVertexRestClientMock).toHaveBeenCalledWith({
      apiKey: 'AIzafull-mode-test-key',
      project: 'pool-project-a',
      location: 'global',
      apiVersion: 'v1',
      timeoutMs: 45678,
    });
    expect(googleGenAiMock).not.toHaveBeenCalled();
  });

  it('passes the target apiKey to the SDK for express mode and does not call the REST client', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig(),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: 'AIzaexpress-mode-test-key',
        apiKeyMode: 'express',
        enabled: true,
        weight: 2,
        label: 'Project A',
        modelAllowlist: [],
        modelExclusions: [],
        source: 'pool',
      },
    );

    const call = googleGenAiMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      vertexai: true,
      apiKey: 'AIzaexpress-mode-test-key',
    });
    expect(call).not.toHaveProperty('project');
    expect(call).not.toHaveProperty('location');
    expect(call).not.toHaveProperty('googleAuthOptions');
    expect(createVertexRestClientMock).not.toHaveBeenCalled();
  });

  it('keeps service-account and no-apiKey targets on the SDK path even when apiKeyMode is full', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig({ googleApiVersion: 'v1beta', upstreamTimeoutMs: 45678 }),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: null,
        apiKeyMode: 'full',
        enabled: true,
        weight: 2,
        label: 'Project A',
        modelAllowlist: [],
        modelExclusions: [],
        source: 'pool',
      },
    );

    expect(googleGenAiMock).toHaveBeenLastCalledWith(expect.objectContaining({
      project: 'pool-project-a',
      location: 'global',
      apiVersion: 'v1beta',
      httpOptions: { timeout: 45678 },
    }));
    expect(createVertexRestClientMock).not.toHaveBeenCalled();
  });
});
