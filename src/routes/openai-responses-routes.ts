import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ClassifiedRoute } from '../http/request-classifier.js';
import { GatewayError } from '../http/error-response.js';
import { driveSseStream, type SseStreamWriter } from '../http/sse-response.js';
import type { GenAiClient } from '../lib/google-genai-client.js';
import { openAiContentToGeminiParts } from './openai-content.js';

interface ResponsesFunctionTool {
  type?: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface ResponsesToolChoiceFunction {
  type?: string;
  name?: string;
}

interface ResponsesContentItem {
  type?: string;
  text?: string;
  image_url?: string | { url?: string };
}

interface ResponsesInputMessage {
  type?: string;
  role?: string;
  content?: unknown;
}

interface OpenAIResponsesRequest {
  model?: string;
  input?: string | ResponsesInputMessage[];
  instructions?: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  stream?: boolean;
  tools?: ResponsesFunctionTool[];
  tool_choice?: 'auto' | 'none' | 'required' | ResponsesToolChoiceFunction;
  parallel_tool_calls?: boolean;
  background?: boolean;
  conversation?: unknown;
  previous_response_id?: string;
  store?: boolean;
  audio?: unknown;
}

const toImageUrl = (value: string | { url?: string }): string => {
  if (typeof value === 'string') return value;
  return typeof value?.url === 'string' ? value.url : '';
};

const toGeminiPartList = (content: unknown, allowImages: boolean): Array<Record<string, unknown>> =>
  openAiContentToGeminiParts(content, allowImages, {
    textOf: (item) => {
      const typedItem = item as ResponsesContentItem;
      return (typedItem.type === 'input_text' || typedItem.type === 'output_text' || typedItem.type === 'text')
        && typeof typedItem.text === 'string'
        ? typedItem.text
        : null;
    },
    imageUrlOf: (item) => {
      const typedItem = item as ResponsesContentItem;
      return typedItem.type === 'input_image' || typedItem.type === 'image_url'
        ? toImageUrl(typedItem.image_url ?? '')
        : null;
    },
    invalidImageMessage: 'OpenAI Responses input images currently require data URLs.',
    allowedImageMimePattern: /^image\/(?:png|jpeg|jpg|webp)$/,
    onUnsupported: (item) => {
      const typedItem = item as ResponsesContentItem;
      throw new GatewayError(400, 'VALIDATION_FAILED', `Unsupported Responses content item type: ${typedItem.type ?? 'unknown'}.`);
    },
  });

const ensureSupportedSubset = (body: OpenAIResponsesRequest, mode: 'sync' | 'stream'): void => {
  if (!body.model?.trim()) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses requests require a model.');
  }
  if (typeof body.input !== 'string' && !Array.isArray(body.input)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses requests require `input` as a string or message array.');
  }
  if (body.background !== undefined) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses background mode is not supported.');
  }
  if (body.conversation !== undefined) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses conversation state is not supported.');
  }
  if (body.previous_response_id !== undefined) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses previous_response_id is not supported.');
  }
  if (body.store !== undefined) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses persistence is not supported.');
  }
  if (body.audio !== undefined) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses audio fields are not supported.');
  }
  if (body.parallel_tool_calls === true) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses parallel_tool_calls is not supported.');
  }

  for (const tool of body.tools ?? []) {
    if (tool?.type !== 'function' || !tool.name?.trim()) {
      throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses supports only custom function tools in this phase.');
    }
  }

  if (mode === 'stream' && (body.tools?.length ?? 0) > 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses streaming tool calls are not implemented yet.');
  }
};

const buildToolConfig = (body: OpenAIResponsesRequest): Record<string, unknown> | undefined => {
  const toolChoice = body.tool_choice;
  if (toolChoice === undefined) return undefined;
  if ((body.tools?.length ?? 0) === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses tool_choice requires custom function tools.');
  }

  if (toolChoice === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } };
  }
  if (toolChoice === 'none') {
    return { functionCallingConfig: { mode: 'NONE' } };
  }
  if (toolChoice === 'required') {
    return { functionCallingConfig: { mode: 'ANY' } };
  }
  if (
    typeof toolChoice === 'object'
    && toolChoice
    && toolChoice.type === 'function'
    && typeof toolChoice.name === 'string'
    && toolChoice.name.trim()
  ) {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.name.trim()],
      },
    };
  }

  throw new GatewayError(400, 'VALIDATION_FAILED', 'Unsupported OpenAI Responses tool_choice value.');
};

const buildGeminiRequest = (
  body: OpenAIResponsesRequest,
  mode: 'sync' | 'stream' = 'sync',
): Record<string, unknown> => {
  ensureSupportedSubset(body, mode);

  const contents: Array<Record<string, unknown>> = [];
  const systemParts: Array<Record<string, unknown>> = [];

  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    systemParts.push({ text: body.instructions.trim() });
  }

  if (typeof body.input === 'string') {
    contents.push({ role: 'user', parts: [{ text: body.input }] });
  } else {
    const inputItems = body.input as ResponsesInputMessage[];
    for (const item of inputItems) {
      if (!item || typeof item !== 'object') {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Each OpenAI Responses input item must be an object.');
      }
      if (item.type !== undefined && item.type !== 'message') {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses currently supports only message input items.');
      }
      if (typeof item.role !== 'string') {
        throw new GatewayError(400, 'VALIDATION_FAILED', 'Each OpenAI Responses message item requires a role.');
      }

      if (item.role === 'system' || item.role === 'developer') {
        systemParts.push(...toGeminiPartList(item.content, false));
        continue;
      }
      if (item.role === 'user') {
        contents.push({ role: 'user', parts: toGeminiPartList(item.content, true) });
        continue;
      }
      if (item.role === 'assistant') {
        contents.push({ role: 'model', parts: toGeminiPartList(item.content, false) });
        continue;
      }
      throw new GatewayError(400, 'VALIDATION_FAILED', `Unsupported OpenAI Responses role: ${item.role}.`);
    }
  }

  if (contents.length === 0) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'OpenAI Responses requires at least one non-system input message.');
  }

  const config: Record<string, unknown> = {};
  if (typeof body.temperature === 'number') config.temperature = body.temperature;
  if (typeof body.top_p === 'number') config.topP = body.top_p;
  if (typeof body.max_output_tokens === 'number') config.maxOutputTokens = body.max_output_tokens;
  if (systemParts.length > 0) config.systemInstruction = { parts: systemParts };

  const tools = (body.tools ?? []).map((tool) => ({
    functionDeclarations: [{
      name: tool.name!.trim(),
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.parameters ? { parameters: tool.parameters } : {}),
    }],
  }));
  const toolConfig = buildToolConfig(body);
  if (tools.length > 0) {
    config.tools = tools;
    if (toolConfig) config.toolConfig = toolConfig;
  } else if (toolConfig) {
    config.toolConfig = toolConfig;
  }

  return {
    model: body.model!.trim(),
    contents,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  };
};

const collectResponseParts = (response: Record<string, unknown>) => {
  const candidates = Array.isArray(response.candidates) ? response.candidates as Array<Record<string, unknown>> : [];
  const candidate = candidates[0] ?? {};
  const content = candidate.content && typeof candidate.content === 'object' ? candidate.content as Record<string, unknown> : {};
  const parts = Array.isArray(content.parts) ? content.parts as Array<Record<string, unknown>> : [];

  const textSegments: string[] = [];
  const functionCalls: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (typeof part.text === 'string' && part.text) {
      textSegments.push(part.text);
    }
    if (part.functionCall && typeof part.functionCall === 'object') {
      const functionCall = part.functionCall as { name?: unknown; args?: unknown };
      if (typeof functionCall.name === 'string') {
        functionCalls.push({
          id: `fc_${randomUUID().replace(/-/g, '')}`,
          type: 'function_call',
          call_id: `call_${randomUUID().replace(/-/g, '')}`,
          name: functionCall.name,
          arguments: JSON.stringify(functionCall.args ?? {}),
        });
      }
    }
  }

  return {
    text: textSegments.join(''),
    functionCalls,
    model: typeof response.modelVersion === 'string' ? response.modelVersion : undefined,
    usageMetadata: response.usageMetadata && typeof response.usageMetadata === 'object'
      ? response.usageMetadata as Record<string, unknown>
      : {},
  };
};

const buildUsage = (usageMetadata: Record<string, unknown>) => ({
  input_tokens: typeof usageMetadata.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : 0,
  output_tokens: typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : 0,
  total_tokens: typeof usageMetadata.totalTokenCount === 'number' ? usageMetadata.totalTokenCount : 0,
});

const buildAssistantMessage = (messageId: string, text: string): Record<string, unknown> => ({
  id: messageId,
  type: 'message',
  status: 'completed',
  role: 'assistant',
  content: [{
    type: 'output_text',
    text,
    annotations: [],
  }],
});

const buildResponseObject = (
  responseId: string,
  messageId: string,
  model: string,
  text: string,
  usageMetadata: Record<string, unknown>,
  functionCalls: Array<Record<string, unknown>> = [],
): Record<string, unknown> => ({
  id: responseId,
  object: 'response',
  created_at: Math.floor(Date.now() / 1000),
  status: 'completed',
  model,
  output: [buildAssistantMessage(messageId, text), ...functionCalls],
  output_text: text,
  usage: buildUsage(usageMetadata),
});

export const runOpenAiResponsesRoute = async (
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  requestId?: string,
): Promise<Record<string, unknown>> => {
  if (route.operation !== 'responses') {
    throw new GatewayError(404, 'NOT_FOUND', 'OpenAI Responses route is not implemented.');
  }

  const request = buildGeminiRequest(body as OpenAIResponsesRequest);
  const response = await ai.models.generateContent(request, {
    routeFamily: 'openai-responses',
    ...(requestId ? { requestId } : {}),
  });
  const responseId = `resp_${randomUUID().replace(/-/g, '')}`;
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  const parsed = collectResponseParts(response);
  return buildResponseObject(
    responseId,
    messageId,
    parsed.model ?? String(request.model),
    parsed.text,
    parsed.usageMetadata,
    parsed.functionCalls,
  );
};

export const runOpenAiResponsesStreamRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  route: ClassifiedRoute,
  body: Record<string, unknown>,
  ai: GenAiClient,
  streamConfig: { idleTimeoutMs: number; maxDurationMs: number },
  requestId?: string,
): Promise<void> => {
  if (route.operation !== 'responses') {
    throw new GatewayError(404, 'NOT_FOUND', 'OpenAI Responses route is not implemented.');
  }
  if (!ai.models.generateContentStream) {
    throw new GatewayError(501, 'NOT_IMPLEMENTED', 'Streaming is not implemented by the configured GenAI client.');
  }

  const request = buildGeminiRequest(body as OpenAIResponsesRequest, 'stream');
  const stream = await ai.models.generateContentStream(request, {
    routeFamily: 'openai-responses',
    ...(requestId ? { requestId } : {}),
    streamGuard: {
      idleTimeoutMs: streamConfig.idleTimeoutMs,
      maxDurationMs: streamConfig.maxDurationMs,
    },
  });
  const responseId = `resp_${randomUUID().replace(/-/g, '')}`;
  const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  const createdAt = Math.floor(Date.now() / 1000);
  let sequenceNumber = 0;
  let sentPreamble = false;
  let fullText = '';
  let latestModel = String(request.model);
  let latestUsageMetadata: Record<string, unknown> = {};

  const writeEvent = (
    writer: SseStreamWriter,
    payload: Record<string, unknown>,
  ): Promise<'written' | 'closed'> => {
    const eventName = typeof payload.type === 'string' ? payload.type : undefined;
    return writer.writeJson({ ...payload, sequence_number: sequenceNumber++ }, eventName);
  };

  await driveSseStream(res, stream, {
    onChunk: async (chunk, index, writer) => {
      if (index === 0) {
        sentPreamble = true;
        if (await writeEvent(writer, {
          type: 'response.created',
          response: {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status: 'in_progress',
            model: latestModel,
            output: [],
          },
        }) === 'closed') return 'stop';

        if (await writeEvent(writer, {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            id: messageId,
            type: 'message',
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
        }) === 'closed') return 'stop';

        if (await writeEvent(writer, {
          type: 'response.content_part.added',
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: {
            type: 'output_text',
            text: '',
          },
        }) === 'closed') return 'stop';
      }

      const parsed = collectResponseParts(chunk);
      latestModel = parsed.model ?? latestModel;
      latestUsageMetadata = parsed.usageMetadata;
      if (parsed.functionCalls.length > 0) {
        await writer.writeError(new GatewayError(
          400,
          'VALIDATION_FAILED',
          'OpenAI Responses streaming tool calls are not implemented yet.',
        ));
        return 'stop';
      }
      if (!parsed.text) return 'continue';
      fullText += parsed.text;
      if (await writeEvent(writer, {
        type: 'response.output_text.delta',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta: parsed.text,
      }) === 'closed') return 'stop';
      return 'continue';
    },
    onComplete: async (writer) => {
      if (!sentPreamble) {
        writer.writeDone();
        return;
      }

      const assistantMessage = buildAssistantMessage(messageId, fullText);

      if (await writeEvent(writer, {
        type: 'response.output_text.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        text: fullText,
      }) === 'closed') return;

      if (await writeEvent(writer, {
        type: 'response.content_part.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: {
          type: 'output_text',
          text: fullText,
          annotations: [],
        },
      }) === 'closed') return;

      if (await writeEvent(writer, {
        type: 'response.output_item.done',
        output_index: 0,
        item: assistantMessage,
      }) === 'closed') return;

      if (await writeEvent(writer, {
        type: 'response.completed',
        response: buildResponseObject(responseId, messageId, latestModel, fullText, latestUsageMetadata),
      }) === 'closed') return;

      writer.writeDone();
    },
  }, { req, idleTimeoutMs: streamConfig.idleTimeoutMs, maxDurationMs: streamConfig.maxDurationMs, errorFormat: 'openai' });
};
