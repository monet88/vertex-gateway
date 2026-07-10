import { describe, expect, it } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { requireGatewayAuth } from '../../src/auth/gateway-auth.js';
import {
  createGenAiPoolSnapshot,
  selectGenAiTarget,
  type GenAiPoolSnapshot,
} from '../../src/lib/genai-pool.js';
import type { GenAiTargetClientFactory } from '../../src/lib/google-genai-client.js';
import { testConfig } from '../test-config.js';

const RUN = process.env.RUN_BENCH === '1';

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const requestWithAuth = (key: string) => {
  const req = new IncomingMessage(new Socket());
  req.headers = { authorization: `Bearer ${key}` };
  return req;
};

const benchOps = (label: string, iterations: number, warmup: number, fn: () => void) => {
  for (let i = 0; i < warmup; i += 1) fn();
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsedNs = Number(process.hrtime.bigint() - started);
  const opsPerSec = iterations / (elapsedNs / 1e9);
  const nsPerOp = elapsedNs / iterations;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    bench: 'm1',
    label,
    iterations,
    warmup,
    opsPerSec: Number(opsPerSec.toFixed(1)),
    nsPerOp: Number(nsPerOp.toFixed(1)),
  }));
  return { opsPerSec, nsPerOp };
};

const mockFactory: GenAiTargetClientFactory = () => ({
  models: {
    generateContent: async () => ({}),
  },
});

const poolSnapshot = (targetCount: number): GenAiPoolSnapshot => {
  const ids = Array.from({ length: targetCount }, (_, i) => `t${i}`);
  const config = testConfig({
    runtimeMode: 'pool',
    vertexPoolSelection: 'round-robin',
    vertexPools: ids.map((id) => ({
      id,
      project: id,
      location: 'global',
      credentialsFile: null,
      apiKey: null,
      apiKeyMode: 'full' as const,
      enabled: true,
      weight: 1,
      modelAllowlist: [],
      modelExclusions: [],
    })),
    resolvedVertexTargets: ids.map((id) => ({
      id,
      project: id,
      location: 'global',
      credentialsFile: null,
      apiKey: null,
      apiKeyMode: 'full' as const,
      enabled: true,
      weight: 1,
      modelAllowlist: [],
      modelExclusions: [],
      source: 'pool' as const,
    })),
  });
  return createGenAiPoolSnapshot(config, mockFactory, 1);
};

describe.skipIf(!RUN)('hot-path M1 microbench', () => {
  it('auth verify throughput for 1/4/16 configured keys', () => {
    for (const keyCount of [1, 4, 16]) {
      const keys = Array.from({ length: keyCount }, (_, i) => `bench-key-${i}`);
      const config = testConfig({ gatewayKeys: keys });
      const valid = keys[keys.length - 1];
      const result = benchOps(`auth.valid.keys=${keyCount}`, 20_000, 2_000, () => {
        requireGatewayAuth(requestWithAuth(valid), config);
      });
      expect(result.opsPerSec).toBeGreaterThan(0);
      expect(() => requireGatewayAuth(requestWithAuth('not-a-real-key'), config)).toThrow(/invalid/);
    }
  });

  it('pool RR select throughput for 2/8/32 healthy targets', () => {
    for (const n of [2, 8, 32]) {
      const snapshot = poolSnapshot(n);
      const result = benchOps(`pool.rr.targets=${n}`, 20_000, 2_000, () => {
        selectGenAiTarget(snapshot);
      });
      expect(result.opsPerSec).toBeGreaterThan(0);
    }
  });

  it('pool RR selection order is stable for fixed cursor and healthy set', () => {
    const snapshot = poolSnapshot(4);
    snapshot.nextIndex = 0;
    const sequence = Array.from({ length: 8 }, () => selectGenAiTarget(snapshot).id);
    expect(sequence).toEqual(['t0', 't1', 't2', 't3', 't0', 't1', 't2', 't3']);
  });

  it('reports ns/op helper sanity', () => {
    const samples = [1, 2, 3, 4, 5];
    expect(percentile(samples, 50)).toBe(3);
    expect(percentile(samples, 99)).toBe(5);
  });
});
