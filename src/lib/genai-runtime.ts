import type { GatewayConfig, ResolvedVertexTargetConfig } from '../config/env.js';
import {
  createGenAiPoolSnapshot,
  GenAiPoolClient,
  snapshotView,
  type GenAiPoolSnapshot,
  type GenAiPoolSnapshotView,
} from './genai-pool.js';
import {
  createGoogleGenAiClientForTarget,
  type GenAiClient,
  type GenAiTargetClientFactory,
} from './google-genai-client.js';

export interface GenAiRuntimeSnapshotView {
  mode: GatewayConfig['runtimeMode'];
  active: GenAiPoolSnapshotView;
}

export interface GenAiRuntimeLike {
  client: GenAiClient;
  getSnapshot(): GenAiRuntimeSnapshotView;
  reload(nextConfig?: GatewayConfig): GenAiRuntimeSnapshotView;
  probeTarget(target: ResolvedVertexTargetConfig): Promise<Record<string, unknown>>;
}

export class GenAiRuntime implements GenAiRuntimeLike {
  readonly client: GenAiClient;

  private version = 0;
  private activeSnapshot: GenAiPoolSnapshot;
  private currentConfig: GatewayConfig;

  constructor(
    config: GatewayConfig,
    private readonly factory: GenAiTargetClientFactory = createGoogleGenAiClientForTarget,
  ) {
    this.currentConfig = config;
    this.activeSnapshot = createGenAiPoolSnapshot(config, this.factory, this.version);
    this.client = new GenAiPoolClient(() => this.activeSnapshot, config.vertexPoolFailoverCooldownMs);
  }

  getSnapshot(): GenAiRuntimeSnapshotView {
    return {
      mode: this.currentConfig.runtimeMode,
      active: snapshotView(this.activeSnapshot),
    };
  }

  reload(nextConfig: GatewayConfig = this.currentConfig): GenAiRuntimeSnapshotView {
    const nextSnapshot = createGenAiPoolSnapshot(nextConfig, this.factory, this.version + 1);
    this.activeSnapshot = nextSnapshot;
    this.currentConfig = nextConfig;
    this.version = nextSnapshot.version;
    return this.getSnapshot();
  }

  async probeTarget(target: ResolvedVertexTargetConfig): Promise<Record<string, unknown>> {
    const client = this.factory(this.currentConfig, target);
    // Pass explicit metadata (second arg) for interface consistency; probe does not need route/request metadata.
    return client.models.generateContent(
      {
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: ok' }] }],
      },
      {},
    );
  }
}

export const createGenAiRuntime = (
  config: GatewayConfig,
  factory?: GenAiTargetClientFactory,
): GenAiRuntime => new GenAiRuntime(config, factory);
