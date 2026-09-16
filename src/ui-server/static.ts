import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, ValidationError } from './errors.js';

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json',
};
export const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string | null): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
  let pathname: string;
  try { pathname = decodeURIComponent((req.url ?? '/').split('?')[0]!); }
  catch { throw new ValidationError('Invalid URL encoding.'); }
  if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part === '..' || part === '.')) throw new ValidationError('Invalid asset path.');
  if (!root) throw new HttpError(503, 'Web UI assets are unavailable. Build or install the web UI assets.', 'ASSETS_UNAVAILABLE');
  let canonical: string;
  try { canonical = await realpath(root); }
  catch { throw new HttpError(503, 'Web UI assets are unavailable. Build or install the web UI assets.', 'ASSETS_UNAVAILABLE'); }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file: string;
  try { file = await realpath(path.join(canonical, relative)); }
  catch { throw new HttpError(relative === 'index.html' ? 503 : 404, 'Asset unavailable.', 'ASSET_NOT_FOUND'); }
  const confined = path.relative(canonical, file);
  if (confined.startsWith(`..${path.sep}`) || confined === '..' || path.isAbsolute(confined)) throw new HttpError(403, 'Asset path is outside the web UI.', 'ASSET_REJECTED');
  const contentType = mime[path.extname(file)];
  if (!contentType || !(await stat(file)).isFile()) throw new HttpError(404, 'Asset not found.', 'ASSET_NOT_FOUND');
  // Apply CSP to every asset, including alternative HTML entry points.
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Content-Type', contentType);
  res.end(req.method === 'HEAD' ? undefined : await readFile(file));
}
