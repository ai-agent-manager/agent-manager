import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.js';

export function responseHeaders(res: ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
export function checkHost(req: IncomingMessage, authority: string): void {
  if (req.headers.host !== authority) throw new HttpError(403, 'Unexpected Host header.', 'HOST_REJECTED');
}
export function checkOrigin(req: IncomingMessage, authority: string): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  // An Origin is a serialized origin, never an arbitrary URL with a path.
  if (origin !== `http://${authority}`) throw new HttpError(403, 'Unexpected Origin header.', 'ORIGIN_REJECTED');
}
export function requireJson(req: IncomingMessage): void {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Use application/json.', 'JSON_REQUIRED');
  }
}
