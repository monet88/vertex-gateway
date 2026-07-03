import { describe, expect, it, vi } from 'vitest';
import { testConfig } from './test-config.js';

const { googleGenAiMock } = vi.hoisted(() => ({
  googleGenAiMock: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: vi.fn() } };
  }),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAiMock,
}));

describe('Google GenAI client', () => {
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

  it('passes the target apiKey to the SDK for express mode and skips service-account auth', async () => {
    const { createGoogleGenAiClientForTarget } = await import('../src/lib/google-genai-client.js');

    createGoogleGenAiClientForTarget(
      testConfig(),
      {
        id: 'project-a',
        project: 'pool-project-a',
        location: 'global',
        credentialsFile: null,
        apiKey: 'AIzaexpress-mode-test-key',
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
    // SDK discards apiKey when project+location are present, so we must omit them.
    expect(call).not.toHaveProperty('project');
    expect(call).not.toHaveProperty('location');
    expect(call).not.toHaveProperty('googleAuthOptions');
  });
});
