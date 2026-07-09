import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createApiCallLogStore,
  maskGatewayKeyPreview,
  redactLogPath,
  statusClassForCode,
} from '../src/admin/api-call-log-store.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const tempLogPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgl-'));
  tempDirs.push(dir);
  return path.join(dir, 'logs', 'api-calls.log');
};

describe('api-call-log-store helpers', () => {
  it('redacts sensitive query params', () => {
    expect(redactLogPath('/openai/v1/models?api_key=secret&x=1')).toBe('/openai/v1/models?[redacted]');
    expect(redactLogPath('/openai/v1/models?x-api-key=secret')).toBe('/openai/v1/models?[redacted]');
    expect(redactLogPath('/openai/v1/models?x-goog-api-key=secret')).toBe('/openai/v1/models?[redacted]');
    expect(redactLogPath('/openai/v1/models')).toBe('/openai/v1/models');
  });

  it('maps status classes and masks gateway keys', () => {
    expect(statusClassForCode(204)).toBe('2xx');
    expect(statusClassForCode(404)).toBe('4xx');
    expect(statusClassForCode(503)).toBe('5xx');
    expect(maskGatewayKeyPreview('vgw_abcdefghijklmnop1234')).toMatch(/^vgw_abcd\.\.\./);
    expect(maskGatewayKeyPreview(null)).toBeNull();
  });
});

describe('createApiCallLogStore', () => {
  it('dual-writes to memory and JSONL and lists newest first', async () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 3, logFilePath });
    store.record({
      requestId: 'r1', method: 'GET', path: '/openai/v1/models?key=abc', statusCode: 200,
      latencyMs: 12, routeFamily: 'openai', operation: 'models', model: 'gemini-3.5-flash',
      gatewayKeyPreview: 'vgw_...1', upstreamTarget: 't1',
    });
    store.record({
      requestId: 'r2', method: 'POST', path: '/openai/v1/chat/completions', statusCode: 500,
      latencyMs: 99, routeFamily: 'openai', operation: 'chatCompletions', errorCode: 'UPSTREAM',
    });
    const rows = store.list({ limit: 10 });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.requestId).toBe('r2');
    expect(rows[1]?.path).toBe('/openai/v1/models?[redacted]');
    expect(rows[0]?.statusClass).toBe('5xx');
    await store.flush();
    const lines = fs.readFileSync(logFilePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).requestId).toBe('r2');
  });

  it('filters by statusClass, method, routeFamily, and search', () => {
    const store = createApiCallLogStore({ maxEntries: 10, logFilePath: tempLogPath() });
    store.record({ requestId: 'a', method: 'GET', path: '/openai/v1/models', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models', model: 'flash' });
    store.record({ requestId: 'b', method: 'POST', path: '/gemini/v1beta/models/x:generateContent', statusCode: 404, latencyMs: 2, routeFamily: 'gemini', operation: 'generateContent' });
    expect(store.list({ statusClass: '4xx' })).toHaveLength(1);
    expect(store.list({ method: 'GET' })[0]?.requestId).toBe('a');
    expect(store.list({ method: 'all' })).toHaveLength(2);
    expect(store.list({ routeFamily: 'gemini' })[0]?.requestId).toBe('b');
    expect(store.list({ routeFamily: 'all' })).toHaveLength(2);
    expect(store.list({ search: 'flash' })[0]?.requestId).toBe('a');
  });

  it('evicts oldest beyond maxEntries and clear removes memory + files', async () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 2, logFilePath, maxFileBytes: 1024 * 1024 });
    store.record({ requestId: '1', method: 'GET', path: '/a', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    store.record({ requestId: '2', method: 'GET', path: '/b', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    store.record({ requestId: '3', method: 'GET', path: '/c', statusCode: 200, latencyMs: 1, routeFamily: 'openai', operation: 'models' });
    expect(store.list().map((e) => e.requestId)).toEqual(['3', '2']);
    await store.clear();
    expect(store.list()).toEqual([]);
    expect(fs.existsSync(logFilePath)).toBe(false);
    expect(fs.existsSync(`${logFilePath}.1`)).toBe(false);
  });

  it('keeps file writes that arrive while clear is in progress', async () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 10, logFilePath });
    store.record({
      requestId: 'old',
      method: 'GET',
      path: '/openai/v1/models',
      statusCode: 200,
      latencyMs: 1,
      routeFamily: 'openai',
      operation: 'models',
    });
    await store.flush();

    const clearPromise = store.clear();
    store.record({
      requestId: 'during-clear',
      method: 'POST',
      path: '/openai/v1/chat/completions',
      statusCode: 200,
      latencyMs: 5,
      routeFamily: 'openai',
      operation: 'chatCompletions',
    });
    await clearPromise;
    await store.flush();

    expect(store.list().map((entry) => entry.requestId)).toEqual(['during-clear']);
    expect(fs.existsSync(logFilePath)).toBe(true);
    const lines = fs.readFileSync(logFilePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).requestId).toBe('during-clear');
  });

  it('rotates active file when maxFileBytes exceeded', async () => {
    const logFilePath = tempLogPath();
    const store = createApiCallLogStore({ maxEntries: 50, logFilePath, maxFileBytes: 200 });
    for (let i = 0; i < 20; i += 1) {
      store.record({
        requestId: `id-${i}-${'x'.repeat(32)}`,
        method: 'POST',
        path: `/openai/v1/chat/completions/${i}`,
        statusCode: 200,
        latencyMs: i,
        routeFamily: 'openai',
        operation: 'chatCompletions',
      });
    }
    await store.flush();
    expect(fs.existsSync(`${logFilePath}.1`)).toBe(true);
    expect(fs.existsSync(logFilePath)).toBe(true);
  });

  it('ignores file errors when logFilePath parent cannot be written but still keeps memory', async () => {
    const store = createApiCallLogStore({
      maxEntries: 5,
      logFilePath: path.join(path.sep, 'definitely-not-writable-vgl', 'api-calls.log'),
    });
    const entry = store.record({
      requestId: 'mem-only', method: 'GET', path: '/openai/v1/models', statusCode: 200,
      latencyMs: 1, routeFamily: 'openai', operation: 'models',
    });
    await store.flush();
    expect(entry?.requestId).toBe('mem-only');
    expect(store.list()).toHaveLength(1);
  });
});
