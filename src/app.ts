import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { GatewayConfig } from './config/env.js';
import { hydrateManagedGatewayKeyHashes } from './admin/gateway-key-store.js';
import { extractGatewayKey, requireGatewayAuth } from './auth/gateway-auth.js';
import { sendError, sendJson, GatewayError } from './http/error-response.js';
import { createRequestContext } from './http/request-context.js';
import { classifyRoute } from './http/request-classifier.js';
import { isStreamingRequest, resolveRouteDispatch, errorFormatForFamily } from './http/route-dispatch.js';
import { applyCors } from './lib/cors.js';
import { readJsonBody } from './lib/read-json.js';
import { StreamAdmission } from './lib/stream-admission.js';
import type { GenAiFactory } from './lib/google-genai-client.js';
import { createGoogleGenAiClient } from './lib/google-genai-client.js';
import { createGenAiRuntime, type GenAiRuntimeLike } from './lib/genai-runtime.js';
import { maybeHandleAdminRoute } from './admin/admin-routes.js';
import { getProviderModelCatalog, listProviderRouteModels, resolveProviderModel } from './admin/model-store.js';
import { renderDocsUi, renderLlmsTxt } from './routes/docs-ui.js';
import { healthResponse, readyResponse, rootResponse } from './routes/health-routes.js';
import { ImageWorkloads } from './workloads/image-workloads.js';

export interface AppOptions {
  config: GatewayConfig;
  genAiFactory?: GenAiFactory;
  runtimeFactory?: (config: GatewayConfig) => GenAiRuntimeLike;
}

const DEFAULT_PUBLIC_DOCS_ORIGIN = 'https://vertex.monet.uno';

const TRUSTED_PUBLIC_PROTOCOLS = new Set(['http', 'https']);

const readSingleHeader = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === 'string') {
    const candidate = value.split(',')[0]?.trim();
    return candidate && candidate.length > 0 ? candidate : undefined;
  }
  if (Array.isArray(value)) {
    const candidate = value[0]?.trim();
    return candidate && candidate.length > 0 ? candidate : undefined;
  }
  return undefined;
};

const isSafePublicHost = (value: string): boolean => {
  if (value.length === 0 || value.length > 255) {
    return false;
  }
  if (/[\\/\s"'`<>]/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(`https://${value}`);
    return parsed.host === value
      && parsed.username === ''
      && parsed.password === ''
      && parsed.pathname === '/'
      && parsed.search === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
};

const resolvePublicDocsOrigin = (req: IncomingMessage): string => {
  const forwardedProto = readSingleHeader(req.headers['x-forwarded-proto'])?.toLowerCase();
  const protocol = forwardedProto && TRUSTED_PUBLIC_PROTOCOLS.has(forwardedProto)
    ? forwardedProto
    : 'https';
  const host = readSingleHeader(req.headers.host);
  if (!host || !isSafePublicHost(host)) {
    return DEFAULT_PUBLIC_DOCS_ORIGIN;
  }
  return `${protocol}://${host}`;
};

export const createApp = ({ config, genAiFactory = createGoogleGenAiClient, runtimeFactory }: AppOptions) => {
  let activeConfig = hydrateManagedGatewayKeyHashes(config);
  const runtime = runtimeFactory
    ? runtimeFactory(activeConfig)
    : (genAiFactory === createGoogleGenAiClient ? createGenAiRuntime(activeConfig) : null);
  const ai = runtime?.client ?? genAiFactory(activeConfig);
  const workloads = new ImageWorkloads(ai, activeConfig);

  const reloadActiveConfig = (nextConfig: GatewayConfig) => {
    runtime?.reload(nextConfig);
    activeConfig = nextConfig;
  };
  const streamAdmission = new StreamAdmission(config.streamPerKeyLimit, config.streamQueueLimit);
  const streamConfig = {
    idleTimeoutMs: config.streamIdleTimeoutMs,
    maxDurationMs: config.streamMaxDurationMs,
  };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const ctx = createRequestContext(req, res);
    let errorFormat: 'gateway' | 'openai' = 'gateway';
    try {
      const url = new URL(req.url ?? '/', 'http://gateway.local');
      if (await maybeHandleAdminRoute(req, res, url, activeConfig, runtime ?? undefined, reloadActiveConfig)) {
        return;
      }

      applyCors(req, res, activeConfig);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        sendJson(res, 200, rootResponse());
        return;
      }
      if (req.method === 'GET' && (url.pathname === '/docs' || url.pathname === '/docs/')) {
        const publicOrigin = resolvePublicDocsOrigin(req);
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(renderDocsUi(publicOrigin));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/llms.txt') {
        const publicOrigin = resolvePublicDocsOrigin(req);
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(renderLlmsTxt(publicOrigin));
        return;
      }
      if (url.pathname === '/healthz') {
        sendJson(res, 200, healthResponse());
        return;
      }
      if (url.pathname === '/readyz') {
        sendJson(res, 200, readyResponse(config, runtime?.getSnapshot()));
        return;
      }

      const route = classifyRoute(req.method ?? 'GET', url.pathname);
      errorFormat = errorFormatForFamily(route.family);
      requireGatewayAuth(req, activeConfig);
      const gatewayKey = extractGatewayKey(req);
      const expectsMultipartOpenAiEdit = route.family === 'openai'
        && route.operation === 'openaiImageEdits'
        && typeof req.headers['content-type'] === 'string'
        && req.headers['content-type'].includes('multipart/form-data');
      const body = req.method === 'GET' || expectsMultipartOpenAiEdit
        ? {}
        : await readJsonBody<Record<string, unknown>>(req, config.maxJsonBytes);
      const resolvedRoute = { ...route };
      const resolvedBody = { ...body };
      const geminiModel = (value: unknown) => resolveProviderModel(activeConfig.modelCatalog, 'gemini', value);
      const openAiModel = (value: unknown) => {
        const catalog = getProviderModelCatalog(activeConfig.modelCatalog, 'openai');
        const hasOpenAiRules = Boolean(
          catalog.defaultModel
          || Object.keys(catalog.aliases).length > 0
          || catalog.allowlist.length > 0
          || catalog.disabled.length > 0,
        );
        return hasOpenAiRules ? resolveProviderModel(activeConfig.modelCatalog, 'openai', value) : undefined;
      };
      if (resolvedRoute.family === 'gemini' || resolvedRoute.family === 'vertex' || resolvedRoute.family === 'vtx') {
        const nextModel = geminiModel(resolvedRoute.model);
        if (nextModel) {
          resolvedRoute.model = nextModel;
        }
      }
      if (resolvedRoute.family === 'custom' && typeof resolvedBody.model !== 'undefined') {
        const nextModel = geminiModel(resolvedBody.model);
        if (nextModel) {
          resolvedBody.model = nextModel;
        }
      }
      if (resolvedRoute.family === 'openai' && typeof resolvedBody.model !== 'undefined') {
        const nextModel = openAiModel(resolvedBody.model) || geminiModel(resolvedBody.model);
        if (nextModel) {
          resolvedBody.model = nextModel;
        }
      }
      const streaming = isStreamingRequest(resolvedRoute, resolvedBody);
      const streamAbortController = new AbortController();
      const abortQueuedStream = () => {
        if (!streamAbortController.signal.aborted) {
          streamAbortController.abort();
        }
      };
      req.once('close', abortQueuedStream);
      req.once('error', abortQueuedStream);
      res.once('close', abortQueuedStream);
      res.once('error', abortQueuedStream);
      const releaseStream = streaming && gatewayKey
        ? await streamAdmission.acquire(gatewayKey, streamAbortController.signal)
        : null;

      try {
        const dispatch = resolveRouteDispatch(resolvedRoute.family);
        if (dispatch) {
          if (!dispatch.isEnabled(config)) {
            throw new GatewayError(404, 'NOT_FOUND', dispatch.disabledMessage);
          }
          await dispatch.run({
            req,
            res,
            route: resolvedRoute,
            body: resolvedBody,
            ai,
            workloads,
            streamConfig,
            requestId: ctx.id,
            abortSignal: streamAbortController.signal,
            maxJsonBytes: config.maxJsonBytes,
            expectsMultipartOpenAiEdit,
            resolveImageEditModel: (value) => openAiModel(value) || geminiModel(value),
            listGeminiModels: () => listProviderRouteModels(activeConfig.modelCatalog, 'gemini'),
          });
          return;
        }
      } finally {
        req.off('close', abortQueuedStream);
        req.off('error', abortQueuedStream);
        res.off('close', abortQueuedStream);
        res.off('error', abortQueuedStream);
        releaseStream?.();
      }

      throw new GatewayError(404, 'NOT_FOUND', 'Route is not implemented.');
    } catch (error) {
      if (error instanceof GatewayError && error.code === 'PAYLOAD_TOO_LARGE') {
        res.once('finish', () => req.destroy());
      }
      if (res.headersSent || res.writableEnded) {
        if (!res.writableEnded && !res.destroyed) {
          try {
            res.end();
          } catch {
            // Socket already closed or streaming handler owned the failure.
          }
        }
        return;
      }
      sendError(res, ctx.id, error, errorFormat);
    } finally {
      ctx.log('request.complete', { status: res.statusCode, latencyMs: Date.now() - ctx.startedAt });
    }
  });
};
