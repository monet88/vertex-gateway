import { GoogleGenAI } from '@google/genai';
import type { GatewayConfig, ResolvedVertexTargetConfig } from '../config/env.js';
import { loadServiceAccountCredential } from '../auth/google-auth.js';

export interface GenAiClient {
  models: {
    generateContent: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    generateContentStream?: (request: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
  };
}

export type GenAiFactory = (config: GatewayConfig) => GenAiClient;
export type GenAiTargetClientFactory = (
  config: GatewayConfig,
  target: ResolvedVertexTargetConfig,
) => GenAiClient;

export const createGoogleGenAiClientForTarget: GenAiTargetClientFactory = (config, target) => {
  const serviceAccount = loadServiceAccountCredential(target.credentialsFile);
  const options: Record<string, unknown> = {
    vertexai: true,
    project: serviceAccount?.project_id ?? target.project,
    location: target.location,
    apiVersion: config.googleApiVersion,
    httpOptions: { timeout: config.upstreamTimeoutMs },
  };
  if (serviceAccount) {
    options.googleAuthOptions = {
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    };
  }
  return new GoogleGenAI(options) as unknown as GenAiClient;
};

export const createGoogleGenAiClient: GenAiFactory = (config) =>
  createGoogleGenAiClientForTarget(config, config.resolvedVertexTargets[0]);
