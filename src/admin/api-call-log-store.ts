import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ApiCallStatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'other';

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
  clear(): Promise<void>;
  flush(): Promise<void>;
  size(): number;
  readonly maxEntries: number;
  readonly logFilePath: string | null;
}

const SENSITIVE_QUERY = /[?&](api_key|key|token|authorization|x-api-key|x-goog-api-key)=/i;

export const redactLogPath = (rawPath: string): string => {
  if (!SENSITIVE_QUERY.test(rawPath)) return rawPath;
  const q = rawPath.indexOf('?');
  return q === -1 ? rawPath : `${rawPath.slice(0, q)}?[redacted]`;
};

export const statusClassForCode = (statusCode: number): ApiCallStatusClass => {
  if (statusCode >= 100 && statusCode < 200) return '1xx';
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return 'other';
};

export const maskGatewayKeyPreview = (secret: string | null | undefined): string | null => {
  if (!secret) return null;
  if (secret.length >= 16) return `${secret.slice(0, 8)}...${secret.slice(-4)}`;
  if (secret.length <= 4) return `${'*'.repeat(Math.max(secret.length, 1))}...`;
  return `${secret.slice(0, 4)}...`;
};

const matchesFilter = (entry: ApiCallLogEntry, filter: ApiCallLogListFilter): boolean => {
  if (filter.statusClass && entry.statusClass !== filter.statusClass) return false;
  if (filter.routeFamily && filter.routeFamily !== 'all' && entry.routeFamily !== filter.routeFamily) return false;
  if (filter.method && filter.method !== 'all' && entry.method.toUpperCase() !== filter.method.toUpperCase()) return false;
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

const appendJsonl = async (
  filePath: string,
  entry: ApiCallLogEntry,
  maxFileBytes: number,
): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  let size = 0;
  try {
    const stat = await fs.promises.stat(filePath);
    size = stat.size;
  } catch {
    size = 0;
  }
  if (size >= maxFileBytes) {
    const backup = `${filePath}.1`;
    try { await fs.promises.rm(backup, { force: true }); } catch { /* ignore */ }
    try { await fs.promises.rename(filePath, backup); } catch { /* ignore */ }
  }
  await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
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
  let writeEpoch = 0;
  let writeChain: Promise<void> = Promise.resolve();

  const enqueueWrite = (task: (epoch: number) => Promise<void>): void => {
    const epoch = writeEpoch;
    writeChain = writeChain
      .then(async () => {
        if (epoch !== writeEpoch) return;
        await task(epoch);
      })
      .catch(() => {
        // best-effort file write; memory already updated
      });
  };

  return {
    maxEntries,
    logFilePath,
    size: () => entries.length,
    flush: async () => {
      await writeChain;
    },
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
        enqueueWrite(async () => {
          await appendJsonl(logFilePath, entry, maxFileBytes);
        });
      }
      return entry;
    },
    list(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), maxEntries);
      return entries.filter((entry) => matchesFilter(entry, filter)).slice(0, limit).map((e) => ({ ...e }));
    },
    async clear() {
      // Bump epoch first so in-flight/queued writes from the previous generation
      // are skipped. File removal must stay on writeChain so any record() that
      // lands after the bump is appended after rm, not deleted by a free-running rm.
      writeEpoch += 1;
      entries.length = 0;
      writeChain = writeChain
        .then(async () => {
          if (!logFilePath) return;
          try { await fs.promises.rm(logFilePath, { force: true }); } catch { /* ignore */ }
          try { await fs.promises.rm(`${logFilePath}.1`, { force: true }); } catch { /* ignore */ }
        })
        .catch(() => {
          // best-effort file clear
        });
      await writeChain;
    },
  };
};
