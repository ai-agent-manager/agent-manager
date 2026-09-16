import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, serialiseError, ValidationError } from './errors.js';

export async function readJsonBody(req: IncomingMessage, limit = 1024 * 1024): Promise<unknown> {
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'Request body is too large.', 'BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  // Event listeners (rather than an early-returning async iterator) keep the
  // socket writable so oversized chunked requests still receive a 413 envelope.
  const data = await new Promise<Buffer>((resolve, reject) => {
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAborted = () => onError(new ValidationError('Request body was interrupted.'));
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { cleanup(); req.resume(); reject(new HttpError(413, 'Request body is too large.', 'BODY_TOO_LARGE')); }
      else chunks.push(chunk);
    };
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted);
  });
  if (data.length === 0) throw new ValidationError('A JSON object is required.');
  try { return JSON.parse(data.toString('utf8')); }
  catch { throw new ValidationError('Malformed JSON.'); }
}
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) { res.destroy(); return; }
  const { status, body } = serialiseError(error);
  sendJson(res, status, body);
}
