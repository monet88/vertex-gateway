import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { GatewayError } from '../http/error-response.js';

const FRONTEND_DIST = path.resolve(process.cwd(), 'frontend', 'dist');
const INDEX_HTML = path.join(FRONTEND_DIST, 'index.html');
const ADMIN_ASSET_PREFIX = '/admin/assets/';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const resolveAdminAssetPath = (pathname: string): string => {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(ADMIN_ASSET_PREFIX.length));
  } catch {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Invalid admin asset path.');
  }
  const resolved = path.resolve(FRONTEND_DIST, 'assets', relative);
  const assetRoot = path.resolve(FRONTEND_DIST, 'assets');
  if (!resolved.startsWith(`${assetRoot}${path.sep}`)) {
    throw new GatewayError(400, 'VALIDATION_FAILED', 'Invalid admin asset path.');
  }
  return resolved;
};

const isReadableFile = (assetPath: string): boolean => {
  try {
    return existsSync(assetPath) && statSync(assetPath).isFile();
  } catch {
    return false;
  }
};

export const renderAdminSpa = async (): Promise<string> => {
  if (!existsSync(INDEX_HTML)) {
    throw new GatewayError(503, 'ADMIN_UI_NOT_BUILT', 'React admin app is not built. Run `cd frontend && npm run build`.');
  }
  return readFile(INDEX_HTML, 'utf8');
};

export const serveAdminAsset = (pathname: string, res: ServerResponse): boolean => {
  if (!pathname.startsWith(ADMIN_ASSET_PREFIX)) return false;
  const assetPath = resolveAdminAssetPath(pathname);
  if (!isReadableFile(assetPath)) {
    throw new GatewayError(404, 'NOT_FOUND', 'Admin asset is not found.');
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentTypes[path.extname(assetPath)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  const stream = createReadStream(assetPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
  return true;
};
