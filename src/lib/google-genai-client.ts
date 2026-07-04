import { GoogleGenAI } from '@google/genai';
import type { GatewayConfig, ResolvedVertexTargetConfig } from '../config/env.js';
import { loadServiceAccountCredential } from '../auth/google-auth.js';
import type { GenAiRequestMetadata } from './genai-request-metadata.js';
import { createVertexRestClient } from './vertex-rest-client.js';

export interface GenAiClient {
  models: {
    generateContent: (
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ) => Promise<Record<string, unknown>>;
    generateContentStream?: (
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ) => Promise<AsyncIterable<Record<string, unknown>>>;
  };
}

export type GenAiFactory = (config: GatewayConfig) => GenAiClient;
export type GenAiTargetClientFactory = (
  config: GatewayConfig,
  target: ResolvedVertexTargetConfig,
) => GenAiClient;

export const createGoogleGenAiClientForTarget: GenAiTargetClientFactory = (config, target) => {
  const apiKey = target.apiKey ?? null;
  if (apiKey && target.apiKeyMode === 'full') {
    return createVertexRestClient({
      apiKey,
      project: target.project,
      location: target.location,
      apiVersion: config.googleApiVersion,
      timeoutMs: config.upstreamTimeoutMs,
    });
  }

  const serviceAccount = apiKey ? null : loadServiceAccountCredential(target.credentialsFile);
  const options: Record<string, unknown> = {
    vertexai: true,
    apiVersion: config.googleApiVersion,
    httpOptions: { timeout: config.upstreamTimeoutMs },
  };
  if (apiKey && target.apiKeyMode === 'express') {
    // Express mode: API key auth, no service account.
    // SDK discards apiKey when project+location are both present,
    // so we intentionally omit them here.
    options.apiKey = apiKey;
  } else {
    options.project = serviceAccount?.project_id ?? target.project;
    options.location = target.location;
    if (serviceAccount) {
      options.googleAuthOptions = {
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      };
    }
  }
  return new GoogleGenAI(options) as unknown as GenAiClient;
};

export const createGoogleGenAiClient: GenAiFactory = (config) =>
  createGoogleGenAiClientForTarget(config, config.resolvedVertexTargets[0]);
