import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, ValidationError } from './errors.js';

export interface RequestContext {
  req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams;
}
type Handler = (context: RequestContext) => void | Promise<void>;
export class Router {
  private routes: Array<{ method: string; parts: string[]; handler: Handler }> = [];
  route(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/'), handler });
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [pathname, search = ''] = (req.url ?? '/').split('?');
    let parts: string[];
    try { parts = pathname!.split('/').map(decodeURIComponent); }
    catch { throw new ValidationError('Invalid URL encoding.'); }
    const matches = this.routes.filter((route) => route.parts.length === parts.length
      && route.parts.every((part, i) => part.startsWith(':') || part === parts[i]));
    const route = matches.find((route) => route.method === req.method);
    if (!route) {
      if (matches.length) res.setHeader('Allow', matches.map((match) => match.method).join(', '));
      throw new HttpError(matches.length ? 405 : 404, matches.length ? 'Method not allowed.' : 'Route not found.', matches.length ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND');
    }
    const params: Record<string, string> = {};
    route.parts.forEach((part, i) => { if (part.startsWith(':')) params[part.slice(1)] = parts[i]!; });
    await route.handler({ req, res, params, query: new URLSearchParams(search) });
  }
}
