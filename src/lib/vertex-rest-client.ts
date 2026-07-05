import { GatewayError } from '../http/error-response.js';
import { withClassifiedGatewayError } from './upstream-error-classifier.js';
import type { GenAiRequestMetadata } from './genai-request-metadata.js';
import type { GenAiClient } from './google-genai-client.js';

export interface VertexRestClientOptions {
  apiKey: string;
  project: string;
  location: string;
  apiVersion: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

const JSON_CONTENT_TYPE = 'application/json';
const SSE_ALT_QUERY = '?alt=sse';
const GENERATION_CONFIG_KEYS = new Set([
  'audioTimestamp',
  'candidateCount',
  'frequencyPenalty',
  'imageConfig',
  'logprobs',
  'maxOutputTokens',
  'mediaResolution',
  'modelSelectionConfig',
  'presencePenalty',
  'responseJsonSchema',
  'responseLogprobs',
  'responseMimeType',
  'responseModalities',
  'responseSchema',
  'routingConfig',
  'seed',
  'speechConfig',
  'stopSequences',
  'temperature',
  'thinkingConfig',
  'topK',
  'topP',
]);
const REQUEST_CONFIG_KEYS = new Set([
  'cachedContent',
  'labels',
  'modelArmorConfig',
  'safetySettings',
  'systemInstruction',
  'toolConfig',
  'tools',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateModel = (request: Record<string, unknown>): string => {
  const model = request.model;
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'generateContent requires a non-empty string model.');
  }
  return model.trim();
};

const buildEndpointBase = (
  apiVersion: string,
  project: string,
  location: string,
): string => {
  if (location === 'global') {
    return `https://aiplatform.googleapis.com/${apiVersion}/projects/${project}/locations/global/publishers/google`;
  }
  return `https://${location}-aiplatform.googleapis.com/${apiVersion}/projects/${project}/locations/${location}/publishers/google`;
};

const buildModelUrl = (
  options: VertexRestClientOptions,
  model: string,
  operation: 'generateContent' | 'streamGenerateContent',
): string => {
  const base = buildEndpointBase(options.apiVersion, options.project, options.location);
  const suffix = operation === 'streamGenerateContent' ? `:${operation}${SSE_ALT_QUERY}` : `:${operation}`;
  return `${base}/models/${encodeURIComponent(model)}${suffix}`;
};

const buildRequestBody = (request: Record<string, unknown>): string => {
  const { model: _model, config, ...rest } = request;
  const nextRequest: Record<string, unknown> = { ...rest };

  if (isRecord(config)) {
    const generationConfig: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (GENERATION_CONFIG_KEYS.has(key)) {
        generationConfig[key] = value;
      } else if (REQUEST_CONFIG_KEYS.has(key)) {
        nextRequest[key] = value;
      }
    }
    if (Object.keys(generationConfig).length > 0) {
      nextRequest.generationConfig = generationConfig;
    }
  }

  return JSON.stringify(nextRequest);
};

const createHeaders = (apiKey: string): Headers => new Headers({
  'content-type': JSON_CONTENT_TYPE,
  'x-goog-api-key': apiKey,
});

const readResponseMessage = async (response: Response): Promise<string> => {
  const text = await response.text();
  if (!text.trim()) {
    return `Vertex upstream returned HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const error = parsed.error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // Fall back to the raw body when the upstream did not return JSON.
  }

  return text;
};

const createUpstreamGatewayError = (
  status: number,
  upstreamMessage: string,
): GatewayError => {
  const mapped = withClassifiedGatewayError({ status, message: upstreamMessage });
  if (mapped.status === status && mapped.message === upstreamMessage) {
    return mapped;
  }
  return new GatewayError(mapped.status, mapped.code, upstreamMessage, mapped.retryable);
};

const createAbortSignal = (
  timeoutMs: number,
  upstreamSignal?: AbortSignal,
): { signal: AbortSignal; cancelTimeout: () => void; didTimeout: () => boolean } => {
  const timeoutController = new AbortController();
  let hasTimedOut = false;
  const timeoutHandle = setTimeout(() => {
    hasTimedOut = true;
    timeoutController.abort(new DOMException('Upstream request timed out.', 'AbortError'));
  }, timeoutMs);

  return {
    signal: upstreamSignal
      ? AbortSignal.any([upstreamSignal, timeoutController.signal])
      : timeoutController.signal,
    cancelTimeout: () => clearTimeout(timeoutHandle),
    didTimeout: () => hasTimedOut,
  };
};

const createNetworkGatewayError = (): GatewayError =>
  new GatewayError(503, 'UPSTREAM_UNAVAILABLE', 'Upstream service is unavailable.', true);

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

const postJson = async (
  options: VertexRestClientOptions,
  url: string,
  body: string,
  signal: AbortSignal,
): Promise<Response> => {
  try {
    return await (options.fetchFn ?? fetch)(url, {
      method: 'POST',
      headers: createHeaders(options.apiKey),
      body,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw createNetworkGatewayError();
  }
};

const fetchJson = async (
  options: VertexRestClientOptions,
  url: string,
  body: string,
  metadata?: GenAiRequestMetadata,
): Promise<Record<string, unknown>> => {
  const { signal, cancelTimeout, didTimeout } = createAbortSignal(options.timeoutMs, metadata?.signal);
  try {
    const response = await postJson(options, url, body, signal);

    if (!response.ok) {
      throw createUpstreamGatewayError(response.status, await readResponseMessage(response));
    }

    return await response.json() as Record<string, unknown>;
  } catch (error) {
    if (didTimeout()) {
      throw new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
    }
    throw error;
  } finally {
    cancelTimeout();
  }
};

const createSseIterator = async function* (
  response: Response,
): AsyncIterable<Record<string, unknown>> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  let completed = false;

  const flushEvent = (): Record<string, unknown> | null => {
    if (dataLines.length === 0) {
      return null;
    }
    const payload = dataLines.join('\n');
    dataLines = [];
    return JSON.parse(payload) as Record<string, unknown>;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

        if (line === '') {
          const event = flushEvent();
          if (event) {
            yield event;
          }
          newlineIndex = buffer.indexOf('\n');
          continue;
        }

        if (line.startsWith(':')) {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }

        if (line.startsWith('data:')) {
          dataLines = [...dataLines, line.slice(5).trimStart()];
        }

        newlineIndex = buffer.indexOf('\n');
      }

      if (done) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          const trailingLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
          if (trailingLine.startsWith('data:')) {
            dataLines = [...dataLines, trailingLine.slice(5).trimStart()];
          }
          buffer = '';
        }
        const event = flushEvent();
        if (event) {
          yield event;
        }
        completed = true;
        return;
      }
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cleanup failures during early iterator termination.
      }
    }
    reader.releaseLock();
  }
};

const fetchStream = async (
  options: VertexRestClientOptions,
  url: string,
  body: string,
  metadata?: GenAiRequestMetadata,
): Promise<AsyncIterable<Record<string, unknown>>> => {
  const { signal, cancelTimeout, didTimeout } = createAbortSignal(options.timeoutMs, metadata?.signal);
  try {
    const response = await postJson(options, url, body, signal);

    if (!response.ok) {
      throw createUpstreamGatewayError(response.status, await readResponseMessage(response));
    }

    cancelTimeout();
    const iterator = createSseIterator(response);
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of iterator) {
            yield event;
          }
        } catch (error) {
          if (didTimeout()) {
            throw new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
          }
          throw error;
        } finally {
          cancelTimeout();
        }
      },
    };
  } catch (error) {
    cancelTimeout();
    if (didTimeout()) {
      throw new GatewayError(504, 'TIMEOUT', 'Upstream request timed out.', true);
    }
    throw error;
  }
};

export const createVertexRestClient = (options: VertexRestClientOptions): GenAiClient => ({
  models: {
    generateContent: async (
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ): Promise<Record<string, unknown>> => {
      const model = validateModel(request);
      return fetchJson(
        options,
        buildModelUrl(options, model, 'generateContent'),
        buildRequestBody(request),
        metadata,
      );
    },
    generateContentStream: async (
      request: Record<string, unknown>,
      metadata?: GenAiRequestMetadata,
    ): Promise<AsyncIterable<Record<string, unknown>>> => {
      const model = validateModel(request);
      return fetchStream(
        options,
        buildModelUrl(options, model, 'streamGenerateContent'),
        buildRequestBody(request),
        metadata,
      );
    },
  },
});
