import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDiagnosticsFlagsCache,
  isDiagnosticsGateEnabled,
  isDiagnosticsWritable,
  readDiagnosticsFlags,
  resolveApiCallLogFilePath,
  writeDiagnosticsFlags,
} from '../src/admin/diagnostics-settings.js';
import { testConfig } from './test-config.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('diagnostics-settings', () => {
  it('defaults both flags off and gate disabled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    expect(readDiagnosticsFlags(config)).toEqual({ debugMode: false, logToFile: false });
    expect(isDiagnosticsGateEnabled(readDiagnosticsFlags(config))).toBe(false);
    expect(isDiagnosticsWritable(config)).toBe(true);
    expect(resolveApiCallLogFilePath(config)).toBe(path.join(dir, 'logs', 'api-calls.log'));
  });

  it('persists flags in admin-settings.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    const next = writeDiagnosticsFlags(config, { debugMode: true, logToFile: true });
    expect(next).toEqual({ debugMode: true, logToFile: true });
    expect(isDiagnosticsGateEnabled(next)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'admin-settings.json'), 'utf8'));
    expect(raw.debugMode).toBe(true);
    expect(raw.logToFile).toBe(true);
    expect(readDiagnosticsFlags(config)).toEqual({ debugMode: true, logToFile: true });
  });

  it('is not writable in static-config', () => {
    const config = testConfig({ adminStoreMode: 'static-config', adminAllowMutations: false, adminFileStoreDir: null });
    expect(isDiagnosticsWritable(config)).toBe(false);
    expect(resolveApiCallLogFilePath(config)).toBeNull();
    expect(() => writeDiagnosticsFlags(config, { debugMode: true })).toThrow(/not writable/i);
  });

  it('returns defaults when admin-settings.json is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'admin-settings.json'), '{not-json', 'utf8');
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    expect(readDiagnosticsFlags(config)).toEqual({ debugMode: false, logToFile: false });
  });

  it('caches flags in memory and does not re-read disk on get', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-diag-'));
    dirs.push(dir);
    const config = testConfig({
      adminStoreMode: 'file-store',
      adminAllowMutations: true,
      adminFileStoreDir: dir,
    });
    const settingsPath = path.join(dir, 'admin-settings.json');
    writeDiagnosticsFlags(config, { debugMode: true, logToFile: true });
    const cache = createDiagnosticsFlagsCache(config);
    expect(cache.isGateEnabled()).toBe(true);

    fs.writeFileSync(settingsPath, JSON.stringify({ debugMode: false, logToFile: false }), 'utf8');
    expect(cache.get()).toEqual({ debugMode: true, logToFile: true });
    expect(cache.isGateEnabled()).toBe(true);

    cache.set({ debugMode: false, logToFile: true });
    expect(cache.isGateEnabled()).toBe(false);
    expect(cache.get()).toEqual({ debugMode: false, logToFile: true });
  });
});
