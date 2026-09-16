import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDevUi } from '../../../scripts/dev-ui.js';

let directory: string;
let ui: Awaited<ReturnType<typeof startDevUi>> | undefined;
afterEach(async () => { await ui?.stop(); vi.unstubAllEnvs(); if (directory) await rm(directory, { recursive: true, force: true }); });
it('serves Vite, API, SSE and guarded HMR on the fallback port', async () => {
  vi.stubEnv('AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS', 'true');
  directory = await mkdtemp(path.join(os.tmpdir(), 'agentman-vite-'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><div>dev fixture</div><script type="module" src="/main.js"></script>');
  await writeFile(path.join(directory, 'main.js'), 'export const fixture = true;');
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const port = (occupied.address() as { port: number }).port;
  try { ui = await startDevUi({ port, cwd: directory, root: directory }); }
  finally { await new Promise<void>((resolve) => occupied.close(() => resolve())); }
  expect(ui.port).not.toBe(port);
  const base = `http://127.0.0.1:${ui.port}`;
  const page = await fetch(base);
  expect(await page.text()).toContain('/@vite/client');
  expect(page.headers.get('access-control-allow-origin')).toBeNull();
  expect(page.headers.get('content-security-policy')).toContain('ws:');
  const client = await (await fetch(`${base}/@vite/client`)).text();
  expect(client).toContain(String(ui.port));
  const token = client.match(/const wsToken = "([^"]+)"/)![1];
  expect((await fetch(`${base}/api/context`, { headers: { authorization: `Bearer ${ui.token}` } })).status).toBe(200);
  expect((await fetch(`${base}/api/context`)).status).toBe(401);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { headers: { authorization: `Bearer ${ui.token}` }, signal: controller.signal });
  expect(new TextDecoder().decode((await stream.body!.getReader().read()).value)).toContain('event: snapshot');
  controller.abort();
  const handshake = (origin: string) => new Promise<string>((resolve, reject) => {
    const socket = connect(ui!.port, '127.0.0.1', () => {
      socket.write(`GET /?token=${token} HTTP/1.1\r\nHost: 127.0.0.1:${ui!.port}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`);
    });
    socket.on('error', reject);
    socket.once('data', (data) => { resolve(data.toString()); socket.destroy(); });
  });
  expect(await handshake(base)).toContain('101 Switching Protocols');
  expect(await handshake('https://example.com')).toContain('403 Forbidden');
});
