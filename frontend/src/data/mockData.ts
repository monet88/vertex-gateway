export type RouteFamily = 'gemini' | 'openai';
export type LogStatus = '2xx' | '4xx' | '5xx';

export interface ApiLogRow {
  id: string;
  time: string;
  routeFamily: RouteFamily;
  operation: string;
  model: string;
  gatewayKey: string;
  upstreamTarget: string;
  latencyMs: number;
  status: LogStatus;
}

export const apiLogs: ApiLogRow[] = [
  {
    id: 'req-01jz7w8q4n',
    time: '14:32:08',
    routeFamily: 'gemini',
    operation: 'generateContent',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...q2a',
    upstreamTarget: 'global-primary',
    latencyMs: 842,
    status: '2xx',
  },
  {
    id: 'req-01jz7w91mf',
    time: '14:31:44',
    routeFamily: 'openai',
    operation: 'chatCompletions',
    model: 'gemini-3.5-flash',
    gatewayKey: 'vgw_...9kp',
    upstreamTarget: 'asia-failover',
    latencyMs: 1290,
    status: '5xx',
  },
  {
    id: 'req-01jz7w9n7c',
    time: '14:30:12',
    routeFamily: 'openai',
    operation: 'images/generations',
    model: 'gemini-3.1-flash-image-preview',
    gatewayKey: 'vgw_...p7m',
    upstreamTarget: 'image-global',
    latencyMs: 2110,
    status: '4xx',
  },
];
