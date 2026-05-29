import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { generateToken, isAuthorised } from './auth.js';
import { dispatch, type RouteContext } from './routes.js';

export const DEFAULT_PORT = 19876;
export const BIND_HOST = '127.0.0.1';

export interface ServerHandle {
  /** The running HTTP server instance */
  server: Server;
  /** Auth token that clients must present */
  token: string;
  /** The port the server is listening on */
  port: number;
  /** Stop the server */
  stop: () => Promise<void>;
}

/**
 * Start the Chrome Extension bridge server.
 *
 * Binds to 127.0.0.1 only — not accessible from the network.
 * All endpoints except GET /health require a Bearer token.
 */
export function startServer(
  ctx: RouteContext,
  port: number = DEFAULT_PORT
): Promise<ServerHandle> {
  const token = generateToken();

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // ---------------------------------------------------------------
      // CORS headers — allow any origin since we have token auth and
      // are bound to localhost only
      // ---------------------------------------------------------------
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Only allow GET requests
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // ---------------------------------------------------------------
      // Auth check — /health is public, everything else requires token
      // ---------------------------------------------------------------
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';

      if (pathname !== '/health') {
        if (!isAuthorised(req, token)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      // ---------------------------------------------------------------
      // Route dispatch
      // ---------------------------------------------------------------
      const handled = dispatch(req, res, ctx);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(port, BIND_HOST, () => {
      const handle: ServerHandle = {
        server,
        token,
        port,
        stop: () =>
          new Promise<void>((resolveStop, rejectStop) => {
            server.close((err) => {
              if (err) rejectStop(err);
              else resolveStop();
            });
          }),
      };
      resolve(handle);
    });
  });
}
