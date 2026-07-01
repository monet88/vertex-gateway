import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('gateway Dockerfile', () => {
  it('uses a lockfile-backed npm ci install for reproducible image builds', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const dockerfile = fs.readFileSync(path.join(testDir, '..', 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('package-lock.json');
    expect(dockerfile).toContain('RUN npm ci');
    expect(dockerfile).not.toContain('RUN npm install');
  });
});
