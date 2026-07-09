import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../../src/app.js';
import { createGenAiRuntime } from '../../src/lib/genai-runtime.js';
import type { GenAiTargetClientFactory } from '../../src/lib/google-genai-client.js';
import { testConfig } from '../test-config.js';

const RUN = process.env.RUN_BENCH === '1';

const WARMUP = 50;
const MEASURE = 200;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const listen = async (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address) resolve(`http://127.0.0.1:${address.port}`);
  });
});

const poolConfig = () => testConfig({
  runtimeMode: 'pool',
  vertexPoolSelection: 'round-robin',
  gatewayKeys: ['bench-key'],
  vertexPools: [
    {
      id: 'a', project: 'a', location: 'global', credentialsFile: null, apiKey: null,
      apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [],
    },
    {
      id: 'b', project: 'b', location: 'global', credentialsFile: null, apiKey: null,
      apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [],
    },
  ],
  resolvedVertexTargets: [
    {
      id: 'a', project: 'a', location: 'global', credentialsFile: null, apiKey: null,
      apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool',
    },
    {
      id: 'b', project: 'b', location: 'global', credentialsFile: null, apiKey: null,
      apiKeyMode: 'full', enabled: true, weight: 1, modelAllowlist: [], modelExclusions: [], source: 'pool',
    },
  ],
  upstreamRetries: 0,
  upstreamRetryDelayMs: 0,
});

const fixedNonStreamResponse = {
  modelVersion: 'gemini-3.5-flash',
  candidates: [{
    content: { parts: [{ text: 'ok' }] },
    finishReason: 'STOP',
  }],
  usageMetadata: {
    promptTokenCount: 1,
    candidatesTokenCount: 1,
    totalTokenCount: 2,
  },
};

const mockFactory = (): GenAiTargetClientFactory => () => ({
  models: {
    generateContent: async () => fixedNonStreamResponse,
    generateContentStream: async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [{ content: { parts: [{ text: 'a' }] } }],
        };
        yield {
          candidates: [{ content: { parts: [{ text: 'b' }] } }],
        };
        yield {
          candidates: [{ content: { parts: [{ text: 'c' }] }, finishReason: 'STOP' }],
        };
      },
    }),
  },
});

const chatBody = (stream: boolean) => JSON.stringify({
  model: 'gemini-3.5-flash',
  stream,
  messages: [{ role: 'user', content: 'hi' }],
});

const geminiBody = () => JSON.stringify({
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
});

type LatencyStats = {
  p50: number;
  p99: number;
  mean: number;
  samples: number;
  throughputRps?: number;
  ttfbP50?: number;
  ttfbP99?: number;
};

const summarize = (latenciesMs: number[], wallMs?: number, extra?: Partial<LatencyStats>): LatencyStats => {
  const sum = latenciesMs.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(latenciesMs, 50),
    p99: percentile(latenciesMs, 99),
    mean: latenciesMs.length ? sum / latenciesMs.length : 0,
    samples: latenciesMs.length,
    ...(wallMs && latenciesMs.length
      ? { throughputRps: latenciesMs.length / (wallMs / 1000) }
      : {}),
    ...extra,
  };
};

const runSerial = async (
  label: string,
  concurrency: number,
  requestOnce: () => Promise<{ latencyMs: number; ttfbMs?: number }>,
): Promise<LatencyStats> => {
  for (let i = 0; i < WARMUP; i += 1) {
    await requestOnce();
  }
  const latencies: number[] = [];
  const ttfbs: number[] = [];
  const wallStart = performance.now();
  if (concurrency <= 1) {
    for (let i = 0; i < MEASURE; i += 1) {
      const sample = await requestOnce();
      latencies.push(sample.latencyMs);
      if (typeof sample.ttfbMs === 'number') ttfbs.push(sample.ttfbMs);
    }
  } else {
    let completed = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (completed < MEASURE) {
        completed += 1;
        if (completed > MEASURE) return;
        const sample = await requestOnce();
        latencies.push(sample.latencyMs);
        if (typeof sample.ttfbMs === 'number') ttfbs.push(sample.ttfbMs);
      }
    });
    await Promise.all(workers);
  }
  const wallMs = performance.now() - wallStart;
  const stats = summarize(latencies, wallMs, ttfbs.length
    ? { ttfbP50: percentile(ttfbs, 50), ttfbP99: percentile(ttfbs, 99) }
    : undefined);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    bench: 'm2',
    label,
    concurrency,
    warmup: WARMUP,
    measure: MEASURE,
    p50Ms: Number(stats.p50.toFixed(3)),
    p99Ms: Number(stats.p99.toFixed(3)),
    meanMs: Number(stats.mean.toFixed(3)),
    throughputRps: stats.throughputRps ? Number(stats.throughputRps.toFixed(1)) : undefined,
    ttfbP50Ms: stats.ttfbP50 !== undefined ? Number(stats.ttfbP50.toFixed(3)) : undefined,
    ttfbP99Ms: stats.ttfbP99 !== undefined ? Number(stats.ttfbP99.toFixed(3)) : undefined,
  }));
  return stats;
};

describe.skipIf(!RUN)('hot-path M2 HTTP integration (pool + mock upstream)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    vi.restoreAllMocks();
  });

  const start = async () => {
    server = createApp({
      config: poolConfig(),
      runtimeFactory: (config) => createGenAiRuntime(config, mockFactory()),
    });
    return listen(server);
  };

  it('S1 OpenAI chat non-stream C=1 and C=10', async () => {
    const baseUrl = await start();
    const once = async () => {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer bench-key',
          'content-type': 'application/json',
        },
        body: chatBody(false),
      });
      await res.arrayBuffer();
      expect(res.status).toBe(200);
      return { latencyMs: performance.now() - t0 };
    };
    const c1 = await runSerial('S1.openai.chat.nonstream', 1, once);
    expect(c1.samples).toBe(MEASURE);
    const c10 = await runSerial('S1.openai.chat.nonstream.C10', 10, once);
    expect(c10.samples).toBe(MEASURE);
  });

  it('S2 OpenAI chat stream C=1 (3 chunks)', async () => {
    const baseUrl = await start();
    const once = async () => {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer bench-key',
          'content-type': 'application/json',
        },
        body: chatBody(true),
      });
      expect(res.status).toBe(200);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('missing body');
      let ttfbMs: number | undefined;
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttfbMs === undefined) ttfbMs = performance.now() - t0;
        buf += decoder.decode(value, { stream: true });
      }
      expect(buf.length).toBeGreaterThan(0);
      return { latencyMs: performance.now() - t0, ttfbMs };
    };
    const stats = await runSerial('S2.openai.chat.stream', 1, once);
    expect(stats.samples).toBe(MEASURE);
    expect(stats.ttfbP50).toBeTypeOf('number');
  });

  it('S3 Gemini generateContent non-stream C=1 and C=10', async () => {
    const baseUrl = await start();
    const once = async () => {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/gemini/v1beta/models/gemini-3.5-flash:generateContent`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer bench-key',
          'content-type': 'application/json',
        },
        body: geminiBody(),
      });
      await res.arrayBuffer();
      expect(res.status).toBe(200);
      return { latencyMs: performance.now() - t0 };
    };
    const c1 = await runSerial('S3.gemini.generateContent', 1, once);
    expect(c1.samples).toBe(MEASURE);
    const c10 = await runSerial('S3.gemini.generateContent.C10', 10, once);
    expect(c10.samples).toBe(MEASURE);
  });

  it('log-cost pass S1 C=1 (production logs vs muted success logs)', async () => {
    const baseUrl = await start();
    const once = async () => {
      const t0 = performance.now();
      const res = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer bench-key',
          'content-type': 'application/json',
        },
        body: chatBody(false),
      });
      await res.arrayBuffer();
      expect(res.status).toBe(200);
      return { latencyMs: performance.now() - t0 };
    };

    const onStats = await runSerial('S1.logcost.logs_on', 1, once);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      if (typeof message === 'string') {
        try {
          const parsed = JSON.parse(message) as { event?: string };
          if (parsed.event === 'request.complete' || parsed.event === 'genai_pool.target_selected') {
            return;
          }
        } catch {
          // keep other info logs silent in muted pass
        }
      }
    });
    try {
      const mutedStats = await runSerial('S1.logcost.logs_muted', 1, once);
      const deltaP50 = onStats.p50 === 0 ? 0 : ((onStats.p50 - mutedStats.p50) / onStats.p50) * 100;
      const deltaP99 = onStats.p99 === 0 ? 0 : ((onStats.p99 - mutedStats.p99) / onStats.p99) * 100;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({
        bench: 'm2',
        label: 'S1.logcost.delta',
        deltaP50Pct: Number(deltaP50.toFixed(2)),
        deltaP99Pct: Number(deltaP99.toFixed(2)),
        f7ThresholdPct: 5,
        shipF7: deltaP50 >= 5 || deltaP99 >= 5,
        logsOnP50Ms: Number(onStats.p50.toFixed(3)),
        mutedP50Ms: Number(mutedStats.p50.toFixed(3)),
        logsOnP99Ms: Number(onStats.p99.toFixed(3)),
        mutedP99Ms: Number(mutedStats.p99.toFixed(3)),
      }));
      expect(mutedStats.samples).toBe(MEASURE);
    } finally {
      infoSpy.mockRestore();
    }
  });
});
