import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayConfig } from '../config/env.js';
import type { ClassifiedRoute, RouteFamily } from './request-classifier.js';
import { sendJson } from './error-response.js';
import type { ErrorFormat } from './error-response.js';
import { sendSseStream } from './sse-response.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import type { ImageWorkloads } from '../workloads/image-workloads.js';
import { runCompatibilityRoute, runCompatibilityStreamRoute } from '../strategies/compatibility-strategy.js';
import { runCustomImageRoute } from '../routes/custom-image-routes.js';
import { runOpenAiImageEditRoute, runOpenAiImageGenerationRoute } from '../routes/openai-images-routes.js';
import { runOpenAiCompatibleRoute, runOpenAiCompatibleStreamRoute } from '../routes/openai-compatible-routes.js';
import { runOpenAiResponsesRoute, runOpenAiResponsesStreamRoute } from '../routes/openai-responses-routes.js';

export const errorFormatForFamily = (family: RouteFamily): ErrorFormat =>
  family === 'openai' ? 'openai' : 'gateway';

/**
 * Everything a route handler needs to fully own its response. Handlers either
 * send a JSON body or take ownership of the socket for streaming; the dispatch
 * table below hides that difference behind a single `run` signature.
 */
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  route: ClassifiedRoute;
  body: Record<string, unknown>;
  ai: GenAiClient;
  workloads: ImageWorkloads;
  streamConfig: { idleTimeoutMs: number; maxDurationMs: number };
  requestId: string;
  maxJsonBytes: number;
  expectsMultipartOpenAiEdit: boolean;
  resolveImageEditModel: (value: unknown) => string | undefined;
}

export interface RouteDispatchEntry {
  isEnabled(config: GatewayConfig): boolean;
  disabledMessage: string;
  run(ctx: RouteContext): Promise<void>;
}

const runCompatibilityFamily = (
  runSync: (ctx: RouteContext) => Promise<Record<string, unknown>>,
) => async (ctx: RouteContext): Promise<void> => {
  if (ctx.route.stream) {
    await sendSseStream(
      ctx.res,
      await runCompatibilityStreamRoute(ctx.route, ctx.body, ctx.ai, ctx.requestId, ctx.streamConfig),
      { includeDone: false, req: ctx.req, ...ctx.streamConfig, errorFormat: errorFormatForFamily(ctx.route.family) },
    );
    return;
  }
  sendJson(ctx.res, 200, await runSync(ctx));
};

const runCompatibilitySync = (ctx: RouteContext) =>
  runCompatibilityRoute(ctx.route, ctx.body, ctx.ai, ctx.requestId);

const runGeminiFamily = runCompatibilityFamily(runCompatibilitySync);

const runVertexFamily = runCompatibilityFamily(runCompatibilitySync);

const runOpenAiFamily = async (ctx: RouteContext): Promise<void> => {
  const {
    req,
    res,
    route,
    body,
    ai,
    workloads,
    streamConfig,
    requestId,
    maxJsonBytes,
    expectsMultipartOpenAiEdit,
    resolveImageEditModel,
  } = ctx;
  if (route.operation === 'openaiImageGenerations') {
    sendJson(res, 200, await runOpenAiImageGenerationRoute(body, workloads, requestId));
    return;
  }
  if (route.operation === 'openaiImageEdits') {
    sendJson(res, 200, await runOpenAiImageEditRoute(
      req,
      expectsMultipartOpenAiEdit ? null : body,
      workloads,
      maxJsonBytes,
      requestId,
      resolveImageEditModel,
    ));
    return;
  }
  if (route.operation === 'chatCompletions' && body.stream === true) {
    await runOpenAiCompatibleStreamRoute(req, res, route, body, ai, streamConfig, requestId);
    return;
  }
  if (route.operation === 'responses' && body.stream === true) {
    await runOpenAiResponsesStreamRoute(req, res, route, body, ai, streamConfig, requestId);
    return;
  }
  if (route.operation === 'responses') {
    sendJson(res, 200, await runOpenAiResponsesRoute(route, body, ai, requestId));
    return;
  }
  sendJson(res, 200, await runOpenAiCompatibleRoute(route, body, ai, requestId));
};

const runCustomFamily = async (ctx: RouteContext): Promise<void> => {
  sendJson(
    ctx.res,
    200,
    await runCustomImageRoute(ctx.route.operation, ctx.body, ctx.workloads, ctx.requestId),
  );
};

/**
 * The single source of truth for which handler serves a route family, whether
 * it is enabled, and the message shown when it is not. `app.ts` looks up an
 * entry and runs it instead of re-deriving the same branches inline.
 */
const ROUTE_DISPATCH: Record<Exclude<RouteFamily, 'health'>, RouteDispatchEntry> = {
  gemini: {
    isEnabled: (config) => config.enableGeminiRoutes,
    disabledMessage: 'Gemini-compatible routes are disabled.',
    run: runGeminiFamily,
  },
  openai: {
    isEnabled: (config) => config.enableOpenAiRoutes,
    disabledMessage: 'OpenAI-compatible routes are disabled.',
    run: runOpenAiFamily,
  },
  vertex: {
    isEnabled: (config) => config.enableVertexRoutes,
    disabledMessage: 'Vertex-compatible routes are disabled.',
    run: runVertexFamily,
  },
  vtx: {
    isEnabled: (config) => config.enableVtxRoutes,
    disabledMessage: 'Vertex-compatible routes are disabled.',
    run: runVertexFamily,
  },
  custom: {
    isEnabled: (config) => config.enableImageRoutes,
    disabledMessage: 'Custom image routes are disabled.',
    run: runCustomFamily,
  },
};

export const resolveRouteDispatch = (family: RouteFamily): RouteDispatchEntry | undefined =>
  family === 'health' ? undefined : ROUTE_DISPATCH[family];

/**
 * Whether a classified request will hold the socket open as an SSE stream, used
 * to decide stream admission before the handler runs.
 */
export const isStreamingRequest = (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
): boolean =>
  ((route.family === 'gemini' || route.family === 'vertex' || route.family === 'vtx') && route.stream)
  || (route.family === 'openai'
    && (route.operation === 'chatCompletions' || route.operation === 'responses')
    && body.stream === true);
