import { withAuthCoordinator } from '../../../src/auth/coordinator.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startUiServer } from '../../../src/ui-server/index.js';
import { resolveStartupSource } from '../../../src/operations/session.js';
import { authenticate, AuthCancelledError } from '../../../src/auth/flow.js';
import { deleteTokens, type StoredTokens } from '../../../src/auth/token-store.js';
import type { JobDto, SessionDto } from '../../../src/ui-server/api-types.js';

const storage = vi.hoisted(() => ({ tokens: null as StoredTokens | null }));
vi.mock('../../../src/operations/session.js', async (original) => ({ ...await original<typeof import('../../../src/operations/session.js')>(), resolveStartupSource: vi.fn() }));
vi.mock('../../../src/auth/flow.js', async (original) => ({ ...await original<typeof import('../../../src/auth/flow.js')>(), authenticate: vi.fn() }));
vi.mock('../../../src/auth/token-store.js', async (original) => ({
  ...await original<typeof import('../../../src/auth/token-store.js')>(), loadTokens: vi.fn(async () => storage.tokens),
  deleteTokens: vi.fn(async () => { storage.tokens = null; }),
}));
const sourceUrl = 'https://skills.example.com';
const auth = { required: true, clientId: 'test-client', oidcDiscoveryUrl: 'http://localhost:8080/oidc/.well-known/openid-configuration' };
let home: string, base: string;
let ui: Awaited<ReturnType<typeof startUiServer>>;
let grant: () => void;
let cleanupCount: number;
beforeEach(async () => {
  vi.clearAllMocks(); storage.tokens = null; cleanupCount = 0;
  home = await mkdtemp(path.join(os.tmpdir(), 'agentman-auth-http-'));
  vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home); vi.stubEnv('AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS', 'true');
  vi.mocked(resolveStartupSource).mockResolvedValue({ source: { type: 'discovery', baseUrl: sourceUrl, discovery: { version: '1', auth, sources: [] } }, stored: { kind: 'discovery', value: sourceUrl } });
  vi.mocked(authenticate).mockImplementation(async (_base, _auth, onPrompt, options) => {
    onPrompt('http://localhost:8080/authorize?state=example-state');
    try {
      await new Promise<void>((resolve, reject) => {
        grant = resolve;
        if (options?.signal?.aborted) reject(new AuthCancelledError());
        else options?.signal?.addEventListener('abort', () => reject(new AuthCancelledError()), { once: true });
      });
      storage.tokens = { bearerToken: 'example-bearer', refreshToken: 'example-refresh', clientId: auth.clientId, oidcDiscoveryUrl: auth.oidcDiscoveryUrl, expiresAt: new Date(Date.now() + 3600000).toISOString() };
      return { bearerToken: storage.tokens.bearerToken, fromCache: false, backend: 'filesystem' };
    } finally { cleanupCount++; }
  });
  ui = await startUiServer({ cwd: home, startupSource: sourceUrl, port: 0, staticDir: null });
  base = `http://127.0.0.1:${ui.port}`;
  await vi.waitFor(async () => expect((await currentJob()).phase).toBe('auth'));
});
afterEach(async () => { await ui?.stop(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
const api = (route: string, method = 'GET') => fetch(base + route, { method, headers: { authorization: `Bearer ${ui.token}`, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) }, ...(method === 'GET' ? {} : { body: '{}' }) });
const session = async (): Promise<SessionDto> => (await api('/api/session')).json();
async function currentJob(): Promise<JobDto> { return (await api(`/api/jobs/${(await session()).loadJobId}`)).json(); }
async function ready() { grant(); await vi.waitFor(async () => expect((await session()).state).toBe('ready')); }
it('retries a cancelled initial login using the unpersisted source and exposes only safe auth status', async () => {
  const initial = await currentJob();
  expect(initial.authorizeUrl).toContain('http://localhost:8080/authorize');
  expect((await api(`/api/jobs/${initial.id}/cancel`, 'POST')).status).toBe(200);
  expect(cleanupCount).toBe(1);
  expect(await session()).toMatchObject({ state: 'idle', auth: { required: true, authenticated: false }, membership: { state: 'not-required' } });
  expect((await session()).error).toBeUndefined();
  const retry = await api('/api/auth/login', 'POST'); expect(retry.status).toBe(202);
  await vi.waitFor(async () => expect((await currentJob()).phase).toBe('auth'));
  expect(resolveStartupSource).toHaveBeenLastCalledWith(sourceUrl, { persist: false });
  await ready();
  const status = await (await api('/api/auth')).json();
  expect(status).toMatchObject({ required: true, authenticated: true, backend: 'filesystem', discoveryBaseUrl: sourceUrl + '/' });
  expect(JSON.stringify(status)).not.toContain('example-bearer');
  expect(JSON.stringify(status)).not.toContain('example-refresh');
  expect((await currentJob()).authorizeUrl).toBeUndefined();
  expect((await api('/api/auth/logout', 'POST')).status).toBe(200);
  expect(await session()).toMatchObject({ state: 'idle', catalogue: [], auth: { required: true, authenticated: false } });
  expect(deleteTokens).toHaveBeenCalledWith({ discoveryBaseUrl: sourceUrl, oidcDiscoveryUrl: auth.oidcDiscoveryUrl, clientId: auth.clientId });
  expect(storage.tokens).toBeNull();
  expect((await (await api('/api/auth')).json()).backend).toBeUndefined();
});
it('logout cancels a pending login before deleting its token identity', async () => {
  const initial = await currentJob();
  expect((await api('/api/auth/logout', 'POST')).status).toBe(200);
  expect(cleanupCount).toBe(1);
  expect((await (await api(`/api/jobs/${initial.id}`)).json()).state).toBe('cancelled');
  expect(deleteTokens).toHaveBeenCalledOnce();
  expect(storage.tokens).toBeNull();
});
it('read-only auth status detects expired tokens without opening a prompt or refreshing them', async () => {
  await ready();
  const count = vi.mocked(authenticate).mock.calls.length;
  storage.tokens!.expiresAt = '2000-01-01T00:00:00Z';
  expect(await (await api('/api/auth')).json()).toMatchObject({ required: true, authenticated: false });
  expect(authenticate).toHaveBeenCalledTimes(count);
});

it('auth status remains readable while another flow owns the auth coordinator', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const owner = withAuthCoordinator(async () => { entered(); await held; });
  await started;
  try {
    const status = await fetch(base + '/api/auth', { headers: { authorization: `Bearer ${ui.token}` }, signal: AbortSignal.timeout(1000) });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ required: true, authenticated: false });
  } finally { release(); await owner; }
});

it('login during source resolution returns STALE_SESSION, then can be retried', async () => {
  await api(`/api/jobs/${(await currentJob()).id}/cancel`, 'POST');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const startup = await vi.mocked(resolveStartupSource).mock.results[0].value;
  vi.mocked(resolveStartupSource).mockImplementationOnce(async () => { await gate; return startup; });
  try {
    expect((await api('/api/auth/login', 'POST')).status).toBe(202);
    const concurrent = await api('/api/auth/login', 'POST');
    expect(concurrent.status).toBe(409);
    expect(await concurrent.json()).toMatchObject({ error: { code: 'STALE_SESSION' } });
  } finally { release(); }
  await vi.waitFor(async () => expect((await currentJob()).phase).toBe('auth'));
  await api(`/api/jobs/${(await currentJob()).id}/cancel`, 'POST');
});
