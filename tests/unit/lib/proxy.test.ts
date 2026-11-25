import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { configureProxyFromEnv } from '../../../src/lib/proxy.js';

const originalDispatcher = getGlobalDispatcher();

function startConnectProxy(): Promise<{ server: Server; port: number; connectHits: string[] }> {
  const connectHits: string[] = [];
  const server = createServer();
  server.on('connect', (req, clientSocket) => {
    connectHits.push(req.url ?? '');
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port, connectHits });
    });
  });
}

describe('configureProxyFromEnv', () => {
  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
    vi.unstubAllEnvs();
  });

  it('leaves the global dispatcher untouched when no proxy env vars are set', () => {
    vi.stubEnv('HTTP_PROXY', undefined);
    vi.stubEnv('http_proxy', undefined);
    vi.stubEnv('HTTPS_PROXY', undefined);
    vi.stubEnv('https_proxy', undefined);

    configureProxyFromEnv();

    expect(getGlobalDispatcher()).toBe(originalDispatcher);
  });

  it('installs a proxy-aware dispatcher when HTTPS_PROXY is set', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:1');

    configureProxyFromEnv();

    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('routes outbound fetch requests through HTTPS_PROXY instead of direct', async () => {
    const { server, port, connectHits } = await startConnectProxy();
    vi.stubEnv('HTTPS_PROXY', `http://127.0.0.1:${port}`);

    configureProxyFromEnv();

    // example.invalid is unresolvable (RFC 2606), so a direct request fails
    // with a DNS error; routed through our proxy it instead reaches the
    // proxy's CONNECT handler, proving the tunnel was used.
    await fetch('https://example.invalid/resource').catch(() => undefined);

    expect(connectHits).toEqual(['example.invalid:443']);

    server.close();
  });
});
