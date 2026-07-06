import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readJsonIfExists, writeJsonAtomic } from '../src/lib/json-file-store.js';

const tempRoots: string[] = [];

const createTempRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vertex-gateway-json-store-'));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('json file store', () => {
  it('reads JSON when the file exists and returns null when it does not', () => {
    const root = createTempRoot();
    const filePath = path.join(root, 'store.json');

    expect(readJsonIfExists(filePath)).toBeNull();

    fs.writeFileSync(filePath, JSON.stringify({ ok: true }), 'utf8');

    expect(readJsonIfExists<{ ok: boolean }>(filePath)).toEqual({ ok: true });
  });

  it('uses a unique temp file in the target directory before replacing the store', () => {
    const root = createTempRoot();
    const filePath = path.join(root, 'store.json');
    const renameSpy = vi.spyOn(fs, 'renameSync');

    writeJsonAtomic(filePath, { value: 1 });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ value: 1 });
    expect(renameSpy).toHaveBeenCalledTimes(1);

    const [tempPath, renamedPath] = renameSpy.mock.calls[0] as [string, string];
    expect(renamedPath).toBe(filePath);
    expect(path.dirname(tempPath)).toBe(root);
    expect(path.basename(tempPath)).not.toBe('store.json.tmp');
    expect(path.basename(tempPath)).toMatch(/^\.store\.json\.\d+\.\d+\.[a-f0-9]+\.tmp$/);
  });

  it('flushes temp file content before renaming it into place', () => {
    const root = createTempRoot();
    const filePath = path.join(root, 'store.json');
    const events: string[] = [];
    const renameSync = fs.renameSync;

    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => {
      events.push('fsync');
    });
    vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      events.push('rename');
      renameSync(oldPath, newPath);
    });

    writeJsonAtomic(filePath, { value: 2 });

    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual({ value: 2 });
    expect(events[0]).toBe('fsync');
    expect(events).toContain('rename');
    expect(events.indexOf('fsync')).toBeLessThan(events.indexOf('rename'));
  });
});
