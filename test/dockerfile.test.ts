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

  it('keeps TypeScript available in the compile stage', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const dockerfile = fs.readFileSync(path.join(testDir, '..', 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS deps');
    expect(dockerfile).toContain('RUN npm ci --omit=optional');
    expect(dockerfile).toContain('FROM deps AS compile');
    expect(dockerfile).toContain('RUN npx tsc -p tsconfig.json');
  });

  it('keeps frontend build tooling available in the frontend build stage', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const dockerfile = fs.readFileSync(path.join(testDir, '..', 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS frontend-deps');
    expect(dockerfile).toContain('WORKDIR /app/frontend');
    expect(dockerfile).toContain('RUN npm ci');
    expect(dockerfile).toContain('FROM frontend-deps AS frontend-build');
    expect(dockerfile).toContain('RUN npm run build');
  });

  it('installs runtime dependencies from a dedicated production-only stage', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const dockerfile = fs.readFileSync(path.join(testDir, '..', 'Dockerfile'), 'utf8');

    expect(dockerfile).toContain('FROM node:22-bookworm-slim AS prod-deps');
    expect(dockerfile).toContain('RUN npm ci --omit=dev --omit=optional --ignore-scripts');
    expect(dockerfile).toContain('COPY --from=prod-deps /app/node_modules ./node_modules');
  });
});
