/** Additional Imposter CI check, deliberately separate from the self-contained suite. */
import { tokenStorageKey } from '../../src/auth/token-store.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startCli } from '../support/cli.js';
import { ready } from '../support/http.js';

const source = process.argv[2]; assert(source, 'Pass the Imposter base URL');
const home = await mkdtemp(path.join(os.tmpdir(), 'agentman-mock-ui-'));
try {
  const auth = (await (await fetch(new URL('/.well-known/agents/discovery.json', source), { signal: AbortSignal.timeout(30_000) })).json()).auth;
  const bearerToken = process.env.AGENTMAN_ACCESS_TOKEN;
  assert(bearerToken && auth?.oidcDiscoveryUrl && auth?.clientId, 'Mock catalogue auth and a CI test token are required');
  const directory = path.join(home, '.agentman/auth');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const identity = { discoveryBaseUrl: source, oidcDiscoveryUrl: auth.oidcDiscoveryUrl, clientId: auth.clientId };
  await writeFile(path.join(directory, `${tokenStorageKey(identity)}.json`), JSON.stringify({ bearerToken, oidcDiscoveryUrl: auth.oidcDiscoveryUrl, clientId: auth.clientId, expiresAt: new Date(Date.now() + 3600000).toISOString() }), { mode: 0o600 });
  const ui = await startCli({ entry: path.resolve('dist/index.js'), cwd: home, source, port: 0, preload: path.resolve('tests/support/disable-keychain.mjs'),
    env: { HOME: home, USERPROFILE: home, DO_NOT_TRACK: 'true', AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: 'true' } });
  try { assert((await ready(ui, 30_000)).catalogue.length > 0); console.log('Imposter UI catalogue smoke passed.'); }
  finally { await ui.stop(); }
} finally { await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
