export type GenAiRouteFamily =
  | 'gemini'
  | 'vertex'
  | 'openai-chat'
  | 'openai-responses'
  | 'images'
  | 'unknown';

export interface GenAiStreamGuardMetadata {
  idleTimeoutMs: number;
  maxDurationMs: number;
}

export interface GenAiRequestMetadata {
  routeFamily?: GenAiRouteFamily;
  streamGuard?: GenAiStreamGuardMetadata;
  requestId?: string;
  signal?: AbortSignal;
}
