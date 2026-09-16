import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findRepoRoot } from '../lib/repo.js';
import { generateToken, isAuthorised } from '../server/auth.js';
import { checkHost, checkOrigin, requireJson, responseHeaders } from './guards.js';
import { HttpError, ValidationError } from './errors.js';
import { readJsonBody, sendError, sendJson } from './http.js';
import { object, query } from './validate.js';
import { Router } from './router.js';
import { JobRegistry } from './jobs.js';
import { SseHub } from './sse.js';
import { SessionStore } from './session-store.js';
import { serveStatic } from './static.js';
import { contextRoutes } from './routes/context.js';
import { sessionRoutes } from './routes/session.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { installRoutes } from './routes/installs.js';
import { sourceRoutes } from './routes/sources.js';
import { settingsRoutes } from './routes/settings.js';
import { jobRoutes } from './routes/jobs.js';

export interface UiServerOptions {
  port?: number; cwd?: string; startupSource?: string; forceUpdate?: boolean; token?: string;
  staticDir?: string | null;
  /** Development middleware is injected by the launcher, never imported here. */
  staticHandler?: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
export async function startUiServer(options: UiServerOptions = {}) {
  const requestedPort = options.port ?? 19877;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new ValidationError('Invalid port.');
  const cwd = await realpath(options.cwd ?? process.cwd());
  const repoRoot = await findRepoRoot(cwd);
  const token = options.token ?? generateToken();
  if (!/^[\x21-\x7e]{16,256}$/.test(token)) throw new ValidationError('Invalid server token.');
  const staticDir = options.staticDir === undefined ? fileURLToPath(new URL('../../assets/web-ui/', import.meta.url)) : options.staticDir;
  const jobs = new JobRegistry();
  const sessions = new SessionStore(jobs, cwd, (dto) => events.broadcast('session', dto));
  const events = new SseHub(() => ({ session: sessions.snapshot(), jobs: jobs.snapshot() }));
  const unsubscribe = jobs.subscribe((dto) => events.broadcast('job', dto));
  const router = new Router();
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let authority = '';
  const requests = new Set<Promise<void>>();
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    responseHeaders(res);
    try {
      checkHost(req, authority); checkOrigin(req, authority);
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('#')) throw new ValidationError('Invalid request target.');
      let pathname: string;
      try { pathname = decodeURIComponent(req.url.split('?')[0]!); } catch { throw new ValidationError('Invalid URL encoding.'); }
      if (pathname === '/health') {
        if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.', 'METHOD_NOT_ALLOWED');
        sendJson(res, 200, { status: 'ok' }); return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        if (!isAuthorised(req, token)) throw new HttpError(401, 'Open the Web UI URL printed by agentman to authorize this tab.', 'UNAUTHORISED');
        if (stopping) throw new HttpError(503, 'The server is stopping.', 'STOPPING');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) requireJson(req);
        await router.handle(req, res);
      } else if (options.staticHandler) await options.staticHandler(req, res);
      else await serveStatic(req, res, staticDir);
    } catch (error) { sendError(res, error); }
  };
  const server = createServer((req, res) => {
    const pending = handle(req, res);
    requests.add(pending);
    void pending.finally(() => requests.delete(pending));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.setTimeout(30_000, (socket) => socket.destroy());
  const stop = (): Promise<void> => {
    if (!stopPromise) {
      stopping = true;
      stopPromise = (async () => {
        // Cancel auth immediately, including when logout/cancel HTTP handlers
        // are waiting for it. Reject job submissions still being parsed and
        // drain already accepted synchronous mutations alongside running jobs.
        await Promise.all([jobs.stop(), ...requests]);
        events.close(); unsubscribe();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      })();
    }
    return stopPromise;
  };
  contextRoutes(router, cwd, repoRoot); sessionRoutes(router, sessions); catalogueRoutes(router, sessions, repoRoot);
  installRoutes(router, sessions, jobs, repoRoot); sourceRoutes(router, sessions); settingsRoutes(router);
  jobRoutes(router, jobs, events);
  router.route('POST', '/api/shutdown', async ({ req, res, query: params }) => {
    query(params, []); object(await readJsonBody(req), []);
    sendJson(res, 200, {});
    setImmediate(() => { void stop().catch(() => server.closeAllConnections()); });
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(requestedPort, '127.0.0.1', () => { server.off('error', onError); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind a TCP port.');
  const port = address.port;
  authority = `127.0.0.1:${port}`;
  try { await sessions.load(options.startupSource, options.forceUpdate); }
  catch (error) { await stop(); throw error; }
  return { server, port, token, url: `http://${authority}/?token=${encodeURIComponent(token)}`, stop };
}
