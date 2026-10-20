import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { OAUTH_CALLBACK_PORT } from '../../src/auth/callback-server.js';

export async function deadline<T>(work: Promise<T>, timeoutMs: number, message: string, force?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try { force?.(); } catch (error) { reject(new Error(message, { cause: error })); return; }
        reject(new Error(message));
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer!); }
}

/** Test-only emergency cleanup. A hung job must fail the test, release its
 * listener/sockets and let the HOME fixture run its own teardown. */
export function boundedServer<T extends { server: Server; stop(): Promise<void> }>(handle: T, timeoutMs = 5_000): T {
  const sockets = new Set<Socket>();
  const connected = (socket: Socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); };
  handle.server.on('connection', connected);
  let stopping: Promise<void> | undefined;
  return { ...handle, stop: () => stopping ??= deadline(Promise.resolve().then(() => handle.stop()), timeoutMs,
    `Test server shutdown exceeded ${timeoutMs}ms; forced its listener and connections closed.`, () => {
      handle.server.closeAllConnections();
      for (const socket of sockets) socket.destroy(); // includes upgraded HMR sockets
      handle.server.close(() => {});
    }).finally(() => handle.server.off('connection', connected)) };
}

export async function assertCallbackPortAvailable(port = OAUTH_CALLBACK_PORT): Promise<void> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve);
    });
  } catch (error) {
    throw new Error(`OAuth test needs callback port ${port}. Finish the other agentman login or auth test suite, then retry.`, { cause: error });
  } finally {
    if (probe.listening) await new Promise<void>((resolve) => probe.close(() => resolve()));
  }
}
