import { GatewayError } from './error-response.js';

export type RouteFamily = 'health' | 'gemini' | 'openai';
export type RouteOperation = 'models' | 'generateContent' | 'streamGenerateContent' | 'chatCompletions' | 'responses' | 'openaiImageGenerations' | 'openaiImageEdits';

export interface ClassifiedRoute {
  family: RouteFamily;
  operation: RouteOperation;
  model?: string;
  project?: string;
  location?: string;
  stateful: boolean;
  stream: boolean;
}

const decodeModel = (value: string): string => decodeURIComponent(value);

export const classifyRoute = (method: string, pathname: string): ClassifiedRoute => {
  if (method === 'GET' && (pathname === '/healthz' || pathname === '/readyz')) {
    return { family: 'health', operation: 'models', stateful: false, stream: false };
  }
  if (method === 'GET' && pathname === '/gemini/v1beta/models') {
    return { family: 'gemini', operation: 'models', stateful: false, stream: false };
  }
  if (method === 'GET' && pathname === '/openai/v1/models') {
    return { family: 'openai', operation: 'models', stateful: false, stream: false };
  }

  const gemini = pathname.match(/^\/gemini\/v1beta\/models\/(.+):(generateContent|streamGenerateContent)$/);
  if (method === 'POST' && gemini) {
    return {
      family: 'gemini',
      operation: gemini[2] as RouteOperation,
      model: decodeModel(gemini[1]),
      stateful: true,
      stream: gemini[2] === 'streamGenerateContent',
    };
  }

  if (method === 'POST' && pathname === '/openai/v1/chat/completions') {
    return { family: 'openai', operation: 'chatCompletions', stateful: true, stream: false };
  }
  if (method === 'POST' && pathname === '/openai/v1/responses') {
    return { family: 'openai', operation: 'responses', stateful: true, stream: false };
  }
  if (method === 'POST' && pathname === '/openai/v1/images/generations') {
    return { family: 'openai', operation: 'openaiImageGenerations', stateful: true, stream: false };
  }
  if (method === 'POST' && pathname === '/openai/v1/images/edits') {
    return { family: 'openai', operation: 'openaiImageEdits', stateful: true, stream: false };
  }

  throw new GatewayError(404, 'NOT_FOUND', 'Route is not enabled by the gateway allowlist.');
};
