import type {
  GatewayConfig,
  ResolvedVertexTargetConfig,
  VertexPoolSelection,
} from '../config/env.js';
import type { GenAiClient, GenAiTargetClientFactory } from './google-genai-client.js';
import type {
  GenAiRequestMetadata,
  GenAiRouteFamily,
} from './genai-request-metadata.js';
import { GatewayError } from '../http/error-response.js';
import { nextStreamStep } from './stream-guards.js';
import { classifyUpstreamError, withClassifiedGatewayError } from './upstream-error-classifier.js';
import { retryWithJitter } from './retry.js';

const RECENT_REQUEST_LIMIT = 10;

export interface GenAiTargetHealthEvent {
  at: string;
  ok: boolean;
  code?: string;
  routeFamily: GenAiRouteFamily;
}

export interface GenAiTargetHealth {
  status: 'healthy' | 'cooldown' | 'disabled';
  success: number;
  failure: number;
  retries: number;
  lastRetryAt?: string;
  recent: GenAiTargetHealthEvent[];
  lastErrorCode?: string;
  lastErrorAt?: string;
  cooldownUntil?: number;
  routeFamilyBuckets: Record<GenAiRouteFamily, { success: number; failure: number }>;
}

export interface GenAiTarget {
  id: string;
  label?: string;
  project: string;
  location: string;
  weight: number;
  modelAllowlist: string[];
  modelExclusions: string[];
  client: GenAiClient;
  health: GenAiTargetHealth;
}

interface WeightedTargetState {
  targetId: string;
  currentWeight: number;
}

export interface GenAiPoolSnapshot {
  version: number;
  selection: VertexPoolSelection;
  targets: readonly GenAiTarget[];
  refCount: number;
  nextIndex: number;
  totalWeight: number;
  weightedStates: WeightedTargetState[];
}

export interface GenAiPoolSnapshotView {
  version: number;
  selection: VertexPoolSelection;
  targetCount: number;
  healthyTargets: number;
  cooldownTargets: number;
  targets: Array<{
    id: string;
    label?: string;
    project: string;
    location: string;
    weight: number;
    health: GenAiTargetHealth;
  }>;
}

const emptyRouteFamilyBuckets = (): Record<GenAiRouteFamily, { success: number; failure: number }> => ({
  gemini: { success: 0, failure: 0 },
  vertex: { success: 0, failure: 0 },
  'openai-chat': { success: 0, failure: 0 },
  'openai-responses': { success: 0, failure: 0 },
  images: { success: 0, failure: 0 },
  unknown: { success: 0, failure: 0 },
});

const createSnapshotTarget = (
  config: GatewayConfig,
  target: ResolvedVertexTargetConfig,
  factory: GenAiTargetClientFactory,
): GenAiTarget => ({
  id: target.id,
  ...(target.label ? { label: target.label } : {}),
  project: target.project,
  location: target.location,
  weight: target.weight,
  modelAllowlist: [...target.modelAllowlist],
  modelExclusions: [...target.modelExclusions],
  client: factory(config, target),
  health: {
    status: 'healthy',
    success: 0,
    failure: 0,
    retries: 0,
    recent: [],
    routeFamilyBuckets: emptyRouteFamilyBuckets(),
  },
});

export const createGenAiPoolSnapshot = (
  config: GatewayConfig,
  factory: GenAiTargetClientFactory,
  version: number,
): GenAiPoolSnapshot => {
  const targets = config.resolvedVertexTargets.map((target) => createSnapshotTarget(config, target, factory));
  if (targets.length === 0) {
    throw new Error('GenAI pool requires at least one resolved target.');
  }
  return {
    version,
    selection: config.vertexPoolSelection,
    targets,
    refCount: 0,
    nextIndex: 0,
    totalWeight: targets.reduce((sum, target) => sum + target.weight, 0),
    weightedStates: targets.map((target) => ({ targetId: target.id, currentWeight: 0 })),
  };
};

export const snapshotView = (snapshot: GenAiPoolSnapshot): GenAiPoolSnapshotView => ({
  version: snapshot.version,
  selection: snapshot.selection,
  targetCount: snapshot.targets.length,
  healthyTargets: snapshot.targets.filter((target) => resolveTargetStatus(target.health) === 'healthy').length,
  cooldownTargets: snapshot.targets.filter((target) => resolveTargetStatus(target.health) === 'cooldown').length,
  targets: snapshot.targets.map((target) => ({
    id: target.id,
    ...(target.label ? { label: target.label } : {}),
    project: target.project,
    location: target.location,
    weight: target.weight,
    health: {
      ...target.health,
      status: resolveTargetStatus(target.health),
      recent: [...target.health.recent],
      routeFamilyBuckets: cloneRouteFamilyBuckets(target.health.routeFamilyBuckets),
    },
  })),
});

const cloneRouteFamilyBuckets = (
  buckets: Record<GenAiRouteFamily, { success: number; failure: number }>,
): Record<GenAiRouteFamily, { success: number; failure: number }> => ({
  gemini: { ...buckets.gemini },
  vertex: { ...buckets.vertex },
  'openai-chat': { ...buckets['openai-chat'] },
  'openai-responses': { ...buckets['openai-responses'] },
  images: { ...buckets.images },
  unknown: { ...buckets.unknown },
});

const resolveTargetStatus = (health: GenAiTargetHealth): GenAiTargetHealth['status'] => {
  if (health.status === 'disabled') return 'disabled';
  if (health.cooldownUntil && health.cooldownUntil > Date.now()) return 'cooldown';
  return 'healthy';
};

const pushRecentEvent = (health: GenAiTargetHealth, event: GenAiTargetHealthEvent): void => {
  health.recent.push(event);
  if (health.recent.length > RECENT_REQUEST_LIMIT) {
    health.recent.splice(0, health.recent.length - RECENT_REQUEST_LIMIT);
  }
};

const markSuccess = (target: GenAiTarget, routeFamily: GenAiRouteFamily): void => {
  target.health.status = 'healthy';
  delete target.health.cooldownUntil;
  target.health.success += 1;
  target.health.routeFamilyBuckets[routeFamily].success += 1;
  pushRecentEvent(target.health, {
    at: new Date().toISOString(),
    ok: true,
    routeFamily,
  });
};

const markFailure = (
  target: GenAiTarget,
  routeFamily: GenAiRouteFamily,
  code: string,
  cooldownMs: number,
  shouldCooldown: boolean,
): void => {
  const at = new Date().toISOString();
  target.health.failure += 1;
  target.health.lastErrorCode = code;
  target.health.lastErrorAt = at;
  target.health.routeFamilyBuckets[routeFamily].failure += 1;
  pushRecentEvent(target.health, {
    at,
    ok: false,
    code,
    routeFamily,
  });
  if (shouldCooldown) {
    target.health.status = 'cooldown';
    target.health.cooldownUntil = Date.now() + cooldownMs;
  }
};

const selectRoundRobinTarget = (
  snapshot: GenAiPoolSnapshot,
  candidates: readonly GenAiTarget[],
): GenAiTarget => {
  for (let attempts = 0; attempts < snapshot.targets.length; attempts += 1) {
    const target = snapshot.targets[snapshot.nextIndex % snapshot.targets.length];
    snapshot.nextIndex = (snapshot.nextIndex + 1) % snapshot.targets.length;
    if (candidates.some((candidate) => candidate.id === target.id)) {
      return target;
    }
  }
  return candidates[0];
};

const selectWeightedRoundRobinTarget = (
  snapshot: GenAiPoolSnapshot,
  candidates: readonly GenAiTarget[],
): GenAiTarget => {
  const candidateIds = new Set(candidates.map((target) => target.id));
  const totalCandidateWeight = candidates.reduce((sum, target) => sum + target.weight, 0);
  let winner: { target: GenAiTarget; currentWeight: number } | null = null;
  for (const state of snapshot.weightedStates) {
    const target = snapshot.targets.find((entry) => entry.id === state.targetId);
    if (!target || !candidateIds.has(target.id)) {
      continue;
    }
    state.currentWeight += target.weight;
    if (!winner || state.currentWeight > winner.currentWeight) {
      winner = { target, currentWeight: state.currentWeight };
    }
  }
  if (!winner) return candidates[0];
  const winningState = snapshot.weightedStates.find((state) => state.targetId === winner.target.id);
  if (winningState) {
    winningState.currentWeight -= totalCandidateWeight;
  }
  return winner.target;
};

const allowsModel = (target: GenAiTarget, requestedModel: string | null): boolean => {
  if (!requestedModel) return true;
  if (target.modelAllowlist.length > 0 && !target.modelAllowlist.includes(requestedModel)) {
    return false;
  }
  if (target.modelExclusions.includes(requestedModel)) {
    return false;
  }
  return true;
};

const selectTargetFromCandidates = (
  snapshot: GenAiPoolSnapshot,
  candidates: readonly GenAiTarget[],
): GenAiTarget =>
  snapshot.selection === 'round-robin'
    ? selectRoundRobinTarget(snapshot, candidates)
    : selectWeightedRoundRobinTarget(snapshot, candidates);

export const selectGenAiTarget = (snapshot: GenAiPoolSnapshot): GenAiTarget => {
  const healthyTargets = snapshot.targets.filter((target) => resolveTargetStatus(target.health) === 'healthy');
  if (healthyTargets.length > 0) {
    return selectTargetFromCandidates(snapshot, healthyTargets);
  }
  const fallbackTarget = [...snapshot.targets].sort((left, right) => {
    const leftCooldown = left.health.cooldownUntil ?? Number.MAX_SAFE_INTEGER;
    const rightCooldown = right.health.cooldownUntil ?? Number.MAX_SAFE_INTEGER;
    return leftCooldown - rightCooldown;
  })[0];
  console.warn(JSON.stringify({
    event: 'genai_pool.all_targets_cooldown',
    targetId: fallbackTarget.id,
    cooldownUntil: fallbackTarget.health.cooldownUntil,
  }));
  return fallbackTarget;
};

const wrapPinnedStream = (
  iterator: AsyncIterator<Record<string, unknown>>,
  firstStep: IteratorResult<Record<string, unknown>>,
  onSuccess: () => void,
  onError: (error: unknown) => void,
  release: () => void,
): AsyncIterable<Record<string, unknown>> => ({
  [Symbol.asyncIterator]() {
    let firstPending: IteratorResult<Record<string, unknown>> | undefined = firstStep;
    let released = false;
    let succeeded = false;
    const safeRelease = () => {
      if (!released) {
        released = true;
        release();
      }
    };
    const safeSuccess = () => {
      if (!succeeded) {
        succeeded = true;
        onSuccess();
      }
    };
    return {
      next: async () => {
        try {
          if (firstPending) {
            const result = firstPending;
            firstPending = undefined;
            return result;
          }
          const result = await iterator.next();
          if (result.done) {
            safeSuccess();
            safeRelease();
          }
          return result;
        } catch (error) {
          onError(error);
          safeRelease();
          throw error;
        }
      },
      return: async (value?: unknown) => {
        try {
          if (typeof iterator.return === 'function') {
            return await iterator.return(value);
          }
          return { done: true, value };
        } finally {
          safeRelease();
        }
      },
      throw: async (error?: unknown) => {
        try {
          if (typeof iterator.throw === 'function') {
            return await iterator.throw(error);
          }
          throw error;
        } catch (thrown) {
          onError(thrown);
          throw thrown;
        } finally {
          safeRelease();
        }
      },
    };
  },
});

export interface PoolRetryConfig {
  cooldownMs: number;
  upstreamRetries: number;
  upstreamRetryDelayMs: number;
}

export class GenAiPoolClient implements GenAiClient {
  readonly models = {
    generateContent: async (
      request: Record<string, unknown>,
      metadata: GenAiRequestMetadata = {},
    ): Promise<Record<string, unknown>> => {
      const snapshot = this.pinSnapshot();
      try {
        const routeFamily = metadata.routeFamily ?? 'unknown';
        return await this.withFailover(
          snapshot,
          routeFamily,
          metadata.requestId,
          this.extractRequestedModel(request),
          metadata.signal,
          (target) => target.client.models.generateContent(request, metadata),
        );
      } finally {
        snapshot.refCount -= 1;
      }
    },
    generateContentStream: async (
      request: Record<string, unknown>,
      metadata: GenAiRequestMetadata = {},
    ): Promise<AsyncIterable<Record<string, unknown>>> => {
      const snapshot = this.pinSnapshot();
      const routeFamily = metadata.routeFamily ?? 'unknown';
      try {
        const attempted = new Set<string>();
        let lastError: unknown;
        const requestedModel = this.extractRequestedModel(request);

        while (attempted.size < snapshot.targets.length) {
          let target;
          try {
            target = this.selectAvailableTarget(snapshot, attempted, requestedModel, metadata.requestId);
          } catch (error) {
            if (lastError) {
              throw lastError;
            }
            throw error;
          }
          attempted.add(target.id);
          console.info(JSON.stringify({
            event: 'genai_pool.target_selected',
            ...(metadata.requestId ? { requestId: metadata.requestId } : {}),
            targetId: target.id,
            routeFamily,
            streaming: true,
          }));

          const { cooldownMs, upstreamRetries, upstreamRetryDelayMs } = this.getRetryConfig();
          const startedAt = Date.now();
          let iterator: AsyncIterator<Record<string, unknown>> | null = null;
          let attempts = 0;

          const shouldRetryOnTarget = (error: unknown): boolean => {
            const c = classifyUpstreamError(error);
            if (c.code === 'TIMEOUT' || c.code === 'UPSTREAM_UNAVAILABLE') return false;
            return c.retryable;
          };

          try {
            const { value: result, retries: retryCount } = await retryWithJitter(
              async () => {
                attempts++;
                // Clean up previous attempt's iterator
                if (iterator && typeof iterator.return === 'function') {
                  try { await iterator.return(); } catch { /* ignore cleanup */ }
                }
                iterator = null;

                if (!target.client.models.generateContentStream) {
                  throw new Error('Configured GenAI target does not support generateContentStream.');
                }
                const stream = await target.client.models.generateContentStream(request, metadata);
                iterator = stream[Symbol.asyncIterator]();
                const firstStep = await nextStreamStep(iterator, {
                  idleTimeoutMs: metadata.streamGuard?.idleTimeoutMs ?? 30_000,
                  maxDurationMs: metadata.streamGuard?.maxDurationMs ?? 240_000,
                  startedAt,
                });
                return { iterator, firstStep };
              },
              upstreamRetries,
              shouldRetryOnTarget,
              upstreamRetryDelayMs,
              metadata.signal,
            );

            if (retryCount > 0) {
              target.health.retries += retryCount;
              target.health.lastRetryAt = new Date().toISOString();
            }

            if (result.firstStep.done) {
              markSuccess(target, routeFamily);
              snapshot.refCount -= 1;
              return {
                async *[Symbol.asyncIterator]() {
                  // Upstream completed before yielding content.
                },
              };
            }
            return wrapPinnedStream(
              result.iterator,
              result.firstStep,
              () => markSuccess(target, routeFamily),
              (error) => {
                const classification = classifyUpstreamError(error);
                markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
              },
              () => { snapshot.refCount -= 1; },
            );
          } catch (error) {
            const retryCount = Math.max(0, attempts - 1);
            if (retryCount > 0) {
              target.health.retries += retryCount;
              target.health.lastRetryAt = new Date().toISOString();
            }
            if (iterator && typeof iterator.return === 'function') {
              try { await iterator.return(); } catch { /* ignore cleanup */ }
            }
            const classification = classifyUpstreamError(error);
            markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
            lastError = withClassifiedGatewayError(error);
            if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
              throw lastError;
            }
          }
        }

        throw withClassifiedGatewayError(lastError ?? new Error('No GenAI targets are available.'));
      } catch (error) {
        snapshot.refCount -= 1;
        throw error;
      }
    },
  };

  constructor(
    private readonly getActiveSnapshot: () => GenAiPoolSnapshot,
    private readonly getRetryConfig: () => PoolRetryConfig,
  ) {}

  private pinSnapshot(): GenAiPoolSnapshot {
    const snapshot = this.getActiveSnapshot();
    snapshot.refCount += 1;
    return snapshot;
  }

  private recordRetry(target: GenAiTarget): void {
    target.health.retries += 1;
    target.health.lastRetryAt = new Date().toISOString();
  }

  private extractRequestedModel(request: Record<string, unknown>): string | null {
    return typeof request.model === 'string' && request.model.trim() ? request.model.trim() : null;
  }

  private selectAvailableTarget(
    snapshot: GenAiPoolSnapshot,
    attempted: Set<string>,
    requestedModel: string | null,
    requestId?: string,
  ): GenAiTarget {
    const healthyTargets = snapshot.targets.filter(
      (target) =>
        !attempted.has(target.id)
        && resolveTargetStatus(target.health) === 'healthy'
        && allowsModel(target, requestedModel),
    );
    if (healthyTargets.length > 0) {
      return selectTargetFromCandidates(snapshot, healthyTargets);
    }
    const candidates = snapshot.targets.filter(
      (target) => !attempted.has(target.id) && allowsModel(target, requestedModel),
    );
    if (candidates.length === 0) {
      if (requestedModel) {
        throw new GatewayError(
          503,
          'UPSTREAM_UNAVAILABLE',
          `No configured GenAI target allows model ${requestedModel}.`,
          true,
        );
      }
      return selectGenAiTarget(snapshot);
    }
    const fallbackTarget = [...candidates].sort((left, right) => {
      const leftCooldown = left.health.cooldownUntil ?? Number.MAX_SAFE_INTEGER;
      const rightCooldown = right.health.cooldownUntil ?? Number.MAX_SAFE_INTEGER;
      return leftCooldown - rightCooldown;
    })[0];
    console.warn(JSON.stringify({
      event: 'genai_pool.all_targets_cooldown',
      ...(requestId ? { requestId } : {}),
      targetId: fallbackTarget.id,
      cooldownUntil: fallbackTarget.health.cooldownUntil,
    }));
    return fallbackTarget;
  }

  private async withFailover(
    snapshot: GenAiPoolSnapshot,
    routeFamily: GenAiRouteFamily,
    requestId: string | undefined,
    requestedModel: string | null,
    signal: AbortSignal | undefined,
    execute: (target: GenAiTarget) => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const attempted = new Set<string>();
    let lastError: unknown;

    while (attempted.size < snapshot.targets.length) {
      let target;
      try {
        target = this.selectAvailableTarget(snapshot, attempted, requestedModel, requestId);
      } catch (error) {
        if (lastError) {
          throw lastError;
        }
        throw error;
      }
      attempted.add(target.id);
      console.info(JSON.stringify({
        event: 'genai_pool.target_selected',
        ...(requestId ? { requestId } : {}),
        targetId: target.id,
        routeFamily,
        streaming: false,
      }));

      const { cooldownMs, upstreamRetries, upstreamRetryDelayMs } = this.getRetryConfig();
      const shouldRetryOnTarget = (error: unknown): boolean => {
        const c = classifyUpstreamError(error);
        if (c.code === 'TIMEOUT' || c.code === 'UPSTREAM_UNAVAILABLE') return false;
        return c.retryable;
      };

      let attempts = 0;
      try {
        const { value: response, retries: retryCount } = await retryWithJitter(
          () => {
            attempts++;
            return execute(target);
          },
          upstreamRetries,
          shouldRetryOnTarget,
          upstreamRetryDelayMs,
          signal,
        );
        if (retryCount > 0) {
          target.health.retries += retryCount;
          target.health.lastRetryAt = new Date().toISOString();
        }
        markSuccess(target, routeFamily);
        return response;
      } catch (error) {
        const retryCount = Math.max(0, attempts - 1);
        if (retryCount > 0) {
          target.health.retries += retryCount;
          target.health.lastRetryAt = new Date().toISOString();
        }
        const classification = classifyUpstreamError(error);
        markFailure(target, routeFamily, classification.code, cooldownMs, classification.shouldCooldown);
        lastError = withClassifiedGatewayError(error);
        if (!classification.shouldFailover || attempted.size >= snapshot.targets.length) {
          throw lastError;
        }
        // break to outer loop for failover
      }
    }

    throw withClassifiedGatewayError(lastError ?? new Error('No GenAI targets are available.'));
  }
}
