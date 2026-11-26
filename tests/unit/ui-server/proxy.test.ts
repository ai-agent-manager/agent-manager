import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { startUiServer } from '../../../src/ui-server/index.js';

const originalDispatcher = getGlobalDispatcher();

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  vi.unstubAllEnvs();
});

it('configures the proxy dispatcher on startup, for consumers that never load index.tsx', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:1');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agentman-ui-proxy-'));

  const server = await startUiServer({ port: 0, cwd: directory, staticDir: null });
  try {
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
  } finally {
    await server.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
