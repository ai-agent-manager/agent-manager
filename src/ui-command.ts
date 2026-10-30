import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { releaseOwnedLocks } from './lib/mutation.js';
import { startUiServer, type UiServerOptions } from './ui-server/index.js';
import { openInBrowser } from './auth/flow.js';
import { trackTelemetryEvent } from './telemetry.js';

export interface UiCommandOptions extends Pick<UiServerOptions, 'cwd' | 'startupSource' | 'forceUpdate' | 'staticDir'> {
  port?: number;
  portExplicit?: boolean;
  open?: boolean;
}

/** CLI lifetime policy lives here; the embeddable HTTP server never exits. */
export async function runUiCommand(options: UiCommandOptions = {}) {
  const staticDir = options.staticDir === undefined ? fileURLToPath(new URL('../assets/web-ui/', import.meta.url)) : options.staticDir;
  if (!staticDir) throw new Error('Web UI assets are missing. Reinstall Agent Manager, or run npm run build:web-ui from the source checkout.');
  await access(path.join(staticDir, 'index.html')).catch(() => {
    throw new Error('Web UI assets are missing. Reinstall Agent Manager, or run npm run build:web-ui from the source checkout.');
  });
  let handle: Awaited<ReturnType<typeof startUiServer>> | undefined;
  let interrupted = false;
  let stopping: Promise<void> | undefined;
  const dispose = () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
  const shutdown = () => {
    if (!handle) return;
    stopping ??= handle.stop().then(() => { process.exitCode = 0; }, (error: unknown) => {
      console.error(`Could not stop the web UI cleanly: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }).finally(dispose);
  };
  const onSignal = () => {
    if (interrupted) {
      console.error('Forcing shutdown; an operation may be incomplete.');
      releaseOwnedLocks();
      handle?.server.closeAllConnections();
      dispose();
      process.exit(130);
    }
    interrupted = true; shutdown();
  };
  // Register before listen/startup, so a signal during initialization still
  // drains any work accepted by the server once its handle becomes available.
  process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal);
  const serverOptions: UiServerOptions = {
    port: options.port ?? 19877, cwd: options.cwd, startupSource: options.startupSource,
    forceUpdate: options.forceUpdate, staticDir: options.staticDir,
  };
  try {
    try { handle = await startUiServer(serverOptions); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      if (options.portExplicit) throw new Error(`Port ${serverOptions.port} is already in use. Choose a different --port (or use --port 0).`);
      console.log(`Port ${serverOptions.port} is in use; choosing an available port.`);
      handle = await startUiServer({ ...serverOptions, port: 0 });
    }
    handle.server.once('close', dispose);
    if (interrupted) { shutdown(); await stopping; return handle; }
    console.log(`Web UI: ${handle.url}`);
    console.log('Press Ctrl-C to stop the web UI.');
    trackTelemetryEvent({ action: 'ui_started', properties: { forceUpdate: options.forceUpdate ?? false } });
    if (options.open !== false) {
      try { await openInBrowser(handle.url); }
      catch { console.error('Could not open the browser automatically. Open the Web UI URL above.'); }
    }
    return handle;
  } catch (error) {
    dispose();
    if (handle) await handle.stop();
    throw error;
  }
}
