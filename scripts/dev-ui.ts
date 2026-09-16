import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { startUiServer } from '../src/ui-server/index.js';
import { checkHost, checkOrigin } from '../src/ui-server/guards.js';
import { sendJson } from '../src/ui-server/http.js';
import { openInBrowser } from '../src/auth/flow.js';
import { parseCli } from '../src/cli.js';

export async function startDevUi(options: {
  port?: number; portExplicit?: boolean; cwd?: string; startupSource?: string; forceUpdate?: boolean; root?: string;
} = {}) {
  let vite: ViteDevServer | undefined;
  const staticHandler = (req: IncomingMessage, res: ServerResponse) => {
    if (!vite) { sendJson(res, 503, { error: { message: 'Development server is starting.' } }); return; }
    // Development-only HMR needs WebSockets. Production CSP remains unchanged.
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    vite.middlewares(req, res, () => sendJson(res, 404, { error: { message: 'Asset not found.' } }));
  };
  let ui: Awaited<ReturnType<typeof startUiServer>>;
  try { ui = await startUiServer({ ...options, port: options.port ?? 19877, staticHandler }); }
  catch (error) {
    if (options.portExplicit || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    console.log(`Port ${options.port ?? 19877} is in use; choosing an available port.`);
    ui = await startUiServer({ ...options, port: 0, staticHandler });
  }
  // Vite's upgrade listener is attached to an unbound transport. Only validated
  // same-origin upgrades from the actual UI port are forwarded to it.
  const hmrTransport = createHttpServer();
  const authority = `127.0.0.1:${ui.port}`;
  ui.server.on('upgrade', (req, socket, head) => {
    try {
      checkHost(req, authority); checkOrigin(req, authority);
      if (!req.headers.origin) throw new Error('Origin is required for HMR.');
      if (new URL(req.url ?? '/', `http://${authority}`).pathname !== '/'
          || !['vite-hmr', 'vite-ping'].includes(String(req.headers['sec-websocket-protocol']))) throw new Error('Unknown upgrade.');
      if (!hmrTransport.emit('upgrade', req, socket, head)) socket.destroy();
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
  });
  try {
    vite = await createViteServer({
      root: options.root ?? fileURLToPath(new URL('../web-ui/', import.meta.url)),
      server: { middlewareMode: true, allowedHosts: ['127.0.0.1'], cors: false,
        hmr: { server: hmrTransport, host: '127.0.0.1', clientPort: ui.port, protocol: 'ws' } },
    });
  } catch (error) { await ui.stop(); throw error; }
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => { await vite!.close(); await ui.stop(); })();
  ui.server.once('close', () => { void vite!.close(); });
  return { ...ui, stop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let stop: (() => Promise<void>) | undefined;
  let interrupted = false;
  const onSignal = () => { interrupted = true; void stop?.(); };
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  try {
    const cli = parseCli(['ui', ...process.argv.slice(2)]);
    const ui = await startDevUi({ port: cli.port, portExplicit: cli.portExplicit, startupSource: cli.source, forceUpdate: cli.forceUpdate });
    stop = ui.stop;
    const dispose = () => { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); };
    ui.server.once('close', dispose);
    if (interrupted) await ui.stop();
    else {
      console.log(`Web UI: ${ui.url}`);
      if (cli.open) await openInBrowser(ui.url).catch(() => console.error('Could not open the browser. Open the Web UI URL above.'));
    }
  } catch (error) {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  }
}
