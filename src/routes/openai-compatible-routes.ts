import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ClassifiedRoute } from '../http/request-classifier.js';
import { GatewayError } from '../http/error-response.js';
import { driveSseStream } from '../http/sse-response.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import { openAiContentToGeminiParts } from './openai-content.js';

interface OpenAIChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAIChatCompletionRequest {
  model?: string;
  messages?: OpenAIChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  n?: number;
  stream?: boolean;
  tools?: Array<{
    type?: string;
    function?: {
      name?: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
}

const OPENAI_MODEL_IDS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

const parseJsonString = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { value: parsed };
  } catch {
    return { value };
  }
};

const toGeminiPartList = (content: unknown, allowImages: boolean): Array<Record<string, unknown>> =>
  openAiContentToGeminiParts(content, allowImages, {
    textOf: (item) => (item.type === 'text' && typeof item.text === 'string' ? item.text : null),
    imageUrlOf: (item) => {
      if (
        item.type === 'image_url'
        && item.image_url
        && typeof item.image_url === 'object'
        && typeof (item.image_url as { url?: unknown }).url === 'string'
      ) {
        return (item.image_url as { url: string }).url || '';
      }
      return null;
    },
    invalidImageMessage: 'OpenAI-compatible image_url currently requires a data URL.',
    allowedImageMimePattern: /^image\/(?:png|jpeg|jpg|webp)$/,
    onUnsupported: () => {
      // Chat Completions silently ignores unsupported content items.
    },
  });

const buildGeminiRequest = (
  body: OpenAIChatCompletionRequest,
  mode: 'sync' | 'stream' = 'sync',
): Record<string, unknown> => {
  if (!body.model?.trim()) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible requests require a model.');
  }
  if (mode === 'sync' && body.stream) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible streaming is not implemented yet.');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible requests require at least one message.');
  }

  const contents: Array<Record<string, unknown>> = [];
  const systemParts: Array<Record<string, unknown>> = [];
  const toolCallNames = new Map<string, string>();

  for (const message of body.messages) {
    if (!message || typeof message.role !== 'string') {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'Each OpenAI-compatible message requires a role.');
    }

    if (message.role === 'system' || message.role === 'developer') {
      systemParts.push(...toGeminiPartList(message.content, false));
      continue;
    }

    if (message.role === 'user') {
      contents.push({ role: 'user', parts: toGeminiPartList(message.content, true) });
      continue;
    }

    if (message.role === 'assistant') {
      const parts = toGeminiPartList(message.content, false);
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.type && toolCall.type !== 'function') {
          throw new GatewayError(400, 'VALIDATION_FAILED', 'Only function tool calls are supported for OpenAI-compatible assistant messages.');
        }
        if (!toolCall.function?.name) {
          throw new GatewayError(400, 'VALIDATION_FAILED', 'Assistant tool calls require a function name.');
        }
        if (toolCall.id) {
          toolCallNames.set(toolCall.id, toolCall.function.name);
        }
        parts.push({
          functionCall: {
            name: toolCall.function.name,
            args: toolCall.function.arguments ? parseJsonString(toolCall.function.arguments) : {},
          },
        });
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    if (message.role === 'tool') {
      const toolName = message.name || (message.tool_call_id ? toolCallNames.get(message.tool_call_id) : undefined);
      if (!toolName) {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Tool messages require a name or a matching tool_call_id.');
      }
      const responsePayload = typeof message.content === 'string'
        ? parseJsonString(message.content)
        : (message.content && typeof message.content === 'object' ? message.content as Record<string, unknown> : {});
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolName,
            response: responsePayload,
          },
        }],
      });
      continue;
    }

    throw new GatewayError(400, 'VALIDATION_FAILED', `Unsupported OpenAI-compatible role: ${message.role}.`);
  }

  const config: Record<string, unknown> = {};
  if (typeof body.temperature === 'number') config.temperature = body.temperature;
  if (typeof body.top_p === 'number') config.topP = body.top_p;
  if (typeof body.max_tokens === 'number') config.maxOutputTokens = body.max_tokens;
  if (typeof body.n === 'number') config.candidateCount = body.n;
  if (typeof body.stop === 'string') config.stopSequences = [body.stop];
  if (Array.isArray(body.stop)) config.stopSequences = body.stop.filter((item): item is string => typeof item === 'string');
  if (systemParts.length > 0) config.systemInstruction = { parts: systemParts };

  const tools = (body.tools ?? [])
    .filter((tool) => tool?.type === 'function' && tool.function?.name)
    .map((tool) => ({
      functionDeclarations: [{
        name: tool.function!.name!,
        ...(tool.function!.description ? { description: tool.function!.description } : {}),
        ...(tool.function!.parameters ? { parameters: tool.function!.parameters } : {}),
      }],
    }));
  if (tools.length > 0) config.tools = tools;

  return {
    model: body.model.trim(),
    contents,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
};

const mapFinishReason = (value: unknown, hasToolCalls: boolean): 'stop' | 'length' | 'tool_calls' | null => {
  if (hasToolCalls) return 'tool_calls';
  if (typeof value !== 'string') return null;
  if (value === 'MAX_TOKENS') return 'length';
  if (value === 'STOP') return 'stop';
  return null;
};

const convertGeminiResponseToOpenAI = (response: Record<string, unknown>, model: string): Record<string, unknown> => {
  const candidates = Array.isArray(response.candidates) ? response.candidates as Array<Record<string, unknown>> : [];
  const choices = (candidates.length > 0 ? candidates : [{}]).map((candidate, index) => {
    const content = candidate.content && typeof candidate.content === 'object' ? candidate.content as Record<string, unknown> : {};
    const parts = Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];

    const textSegments: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const part of parts) {
      if (typeof part.text === 'string' && part.text) {
        textSegments.push(part.text);
      }
      if (part.functionCall && typeof part.functionCall === 'object') {
        const functionCall = part.functionCall as { name?: unknown; args?: unknown };
        if (typeof functionCall.name === 'string') {
          toolCalls.push({
            id: `call_${randomUUID().replace(/-/g, '')}`,
            type: 'function',
            function: {
              name: functionCall.name,
              arguments: JSON.stringify(functionCall.args ?? {}),
            },
          });
        }
      }
    }

    return {
      index,
      message: {
        role: 'assistant',
        content: textSegments.join('') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: mapFinishReason(candidate.finishReason, toolCalls.length > 0),
    };
  });
  const usageMetadata = response.usageMetadata && typeof response.usageMetadata === 'object'
    ? response.usageMetadata as Record<string, unknown>
    : {};

  return {
    id: `chatcmpl_${randomUUID().replace(/-/g, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof response.modelVersion === 'string' ? response.modelVersion : model,
    choices,
    usage: {
      prompt_tokens: typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : 0,
      completion_tokens: typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : 0,
      total_tokens: typeof usageMetadata.totalTokenCount === 'number' ? usageMetadata.totalTokenCount : 0,
    },
  };
};

const normalizeStreamChunk = (
  response: Record<string, unknown>,
): { text: string; finishReason: 'stop' | 'length' | 'tool_calls' | null; hasToolCalls: boolean; model?: string } => {
  const candidate = Array.isArray(response.candidates) ? response.candidates[0] as Record<string, unknown> | undefined : undefined;
  const content = candidate?.content && typeof candidate.content === 'object' ? candidate.content as Record<string, unknown> : undefined;
  const parts = Array.isArray(content?.parts) ? content.parts as Array<Record<string, unknown>> : [];

  const textSegments: string[] = [];
  let hasToolCalls = false;
  for (const part of parts) {
    if (typeof part.text === 'string' && part.text) {
      textSegments.push(part.text);
    }
    if (part.functionCall && typeof part.functionCall === 'object') {
      hasToolCalls = true;
    }
  }

  return {
    text: textSegments.join(''),
    finishReason: mapFinishReason(candidate?.finishReason, hasToolCalls),
    hasToolCalls,
    model: typeof response.modelVersion === 'string' ? response.modelVersion : undefined,
  };
};

const assertOpenAiStreamRequestSupported = (body: OpenAIChatCompletionRequest): void => {
  if (body.stream !== true) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible streaming requires `stream: true`.');
  }
  if (typeof body.n === 'number' && body.n !== 1) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible streaming currently supports only `n: 1`.');
  }
  if ((body.tools?.length ?? 0) > 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI-compatible streaming tool calls are not implemented yet.');
  }
};

const listModels = (): Record<string, unknown> => ({
  object: 'list',
  data: OPENAI_MODEL_IDS.map((id) => ({
    id,
    object: 'model',
    created: 0,
    owned_by: 'google',
  })),
});

export const runOpenAiCompatibleRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
): Promise<Record<string, unknown>> => {
  if (route.operation === 'models') {
    return listModels();
  }
  if (route.operation !== 'chatCompletions') {
    throw new GatewayError(404, 'NOT_FOUND', 'OpenAI-compatible route is not implemented.');
  }

  const request = buildGeminiRequest(body as OpenAIChatCompletionRequest);
  const response = await ai.models.generateContent(request, {
    routeFamily: 'openai-chat',
    ...(requestId ? { requestId } : {}),
  });
  return convertGeminiResponseToOpenAI(response, String(request.model));
};

export const runOpenAiCompatibleStreamRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  streamConfig: { idleTimeoutMs: number; maxDurationMs: number },
  requestId?: string,
): Promise<void> => {
  if (route.operation !== 'chatCompletions') {
    throw new GatewayError(404, 'NOT_FOUND', 'OpenAI-compatible route is not implemented.');
  }
  if (!ai.models.generateContentStream) {
    throw new GatewayError(501, 'NOT_IMPLEMENTED', 'Streaming is not implemented by the configured GenAI client.');
  }

  const requestBody = body as OpenAIChatCompletionRequest;
  assertOpenAiStreamRequestSupported(requestBody);
  const request = buildGeminiRequest(requestBody, 'stream');
  const stream = await ai.models.generateContentStream(request, {
    routeFamily: 'openai-chat',
    ...(requestId ? { requestId } : {}),
    streamGuard: {
      idleTimeoutMs: streamConfig.idleTimeoutMs,
      maxDurationMs: streamConfig.maxDurationMs,
    },
  });
  const completionId = `chatcmpl_${randomUUID().replace(/-/g, '')}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;

  await driveSseStream(res, stream, {
    onChunk: async (chunk, _index, writer) => {
      const normalized = normalizeStreamChunk(chunk);
      if (normalized.hasToolCalls) {
        await writer.writeError(new GatewayError(
          400,
          'VALIDATION_FAILED',
          'OpenAI-compatible streaming tool calls are not implemented yet.',
        ));
        return 'stop';
      }

      const delta: Record<string, unknown> = {};
      if (!sentRole) {
        delta.role = 'assistant';
        sentRole = true;
      }
      if (normalized.text) {
        delta.content = normalized.text;
      }
      if (Object.keys(delta).length === 0 && normalized.finishReason === null) {
        return 'continue';
      }

      const status = await writer.writeJson({
        id: completionId,
        object: 'chat.completion.chunk',
        created,
        model: normalized.model ?? String(request.model),
        choices: [{
          index: 0,
          delta,
          finish_reason: normalized.finishReason,
        }],
      });
      return status === 'closed' ? 'stop' : 'continue';
    },
    onComplete: (writer) => {
      writer.writeDone();
    },
  }, { req, idleTimeoutMs: streamConfig.idleTimeoutMs, maxDurationMs: streamConfig.maxDurationMs, errorFormat: 'openai' });
};
