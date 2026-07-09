import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ApiCallStatusClass = '2xx' | '4xx' | '5xx';

export interface ApiCallLogEntry {
  id: string;
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  statusClass: ApiCallStatusClass;
  latencyMs: number;
  routeFamily: string;
  operation: string;
  model?: string;
  gatewayKeyPreview?: string | null;
  upstreamTarget?: string | null;
  errorCode?: string | null;
}

export type ApiCallLogInput = Omit<ApiCallLogEntry, 'id' | 'timestamp' | 'statusClass' | 'path'> & {
  path: string;
  statusCode: number;
};

export interface ApiCallLogListFilter {
  limit?: number;
  statusClass?: ApiCallStatusClass;
  routeFamily?: string;
  method?: string;
  search?: string;
}

export interface ApiCallLogStore {
  record(input: ApiCallLogInput): ApiCallLogEntry | null;
  list(filter?: ApiCallLogListFilter): ApiCallLogEntry[];
  clear(): void;
  size(): number;
  readonly maxEntries: number;
  readonly logFilePath: string | null;
}

const SENSITIVE_QUERY = /[?&](api_key|key|token|authorization)=/i;

export const redactLogPath = (rawPath: string): string => {
  if (!SENSITIVE_QUERY.test(rawPath)) return rawPath;
  const q = rawPath.indexOf('?');
  return q === -1 ? rawPath : `${rawPath.slice(0, q)}?[redacted]`;
};

export const statusClassForCode = (statusCode: number): ApiCallStatusClass => {
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  return '5xx';
};

export const maskGatewayKeyPreview = (secret: string | null | undefined): string | null => {
  if (!secret) return null;
  if (secret.length >= 16) return `${secret.slice(0, 8)}...${secret.slice(-4)}`;
  if (secret.length <= 4) return `${'*'.repeat(Math.max(secret.length, 1))}...`;
  return `${secret.slice(0, 4)}...`;
};

const matchesFilter = (entry: ApiCallLogEntry, filter: ApiCallLogListFilter): boolean => {
  if (filter.statusClass && entry.statusClass !== filter.statusClass) return false;
  if (filter.routeFamily && entry.routeFamily !== filter.routeFamily) return false;
  if (filter.method && entry.method.toUpperCase() !== filter.method.toUpperCase()) return false;
  const search = filter.search?.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    entry.path,
    entry.requestId,
    entry.model ?? '',
    entry.gatewayKeyPreview ?? '',
    entry.upstreamTarget ?? '',
    entry.operation,
  ].join(' ').toLowerCase();
  return haystack.includes(search);
};

const appendJsonl = (filePath: string, entry: ApiCallLogEntry, maxFileBytes: number): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    size = 0;
  }
  if (size >= maxFileBytes) {
    const backup = `${filePath}.1`;
    try { fs.rmSync(backup, { force: true }); } catch { /* ignore */ }
    try { fs.renameSync(filePath, backup); } catch { /* ignore */ }
  }
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
};

export const createApiCallLogStore = (options: {
  maxEntries?: number;
  logFilePath: string | null;
  maxFileBytes?: number;
}): ApiCallLogStore => {
  const maxEntries = options.maxEntries ?? 500;
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  const logFilePath = options.logFilePath;
  const entries: ApiCallLogEntry[] = [];

  return {
    maxEntries,
    logFilePath,
    size: () => entries.length,
    record(input) {
      const entry: ApiCallLogEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: input.requestId,
        method: input.method.toUpperCase(),
        path: redactLogPath(input.path),
        statusCode: input.statusCode,
        statusClass: statusClassForCode(input.statusCode),
        latencyMs: input.latencyMs,
        routeFamily: input.routeFamily,
        operation: input.operation,
        model: input.model,
        gatewayKeyPreview: input.gatewayKeyPreview ?? null,
        upstreamTarget: input.upstreamTarget ?? null,
        errorCode: input.errorCode ?? null,
      };
      entries.unshift(entry);
      if (entries.length > maxEntries) entries.length = maxEntries;
      if (logFilePath) {
        try {
          appendJsonl(logFilePath, entry, maxFileBytes);
        } catch {
          // best-effort file write; memory already updated
        }
      }
      return entry;
    },
    list(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), maxEntries);
      return entries.filter((entry) => matchesFilter(entry, filter)).slice(0, limit).map((e) => ({ ...e }));
    },
    clear() {
      entries.length = 0;
      if (!logFilePath) return;
      try { fs.rmSync(logFilePath, { force: true }); } catch { /* ignore */ }
      try { fs.rmSync(`${logFilePath}.1`, { force: true }); } catch { /* ignore */ }
    },
  };
};
