import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JobRegistry } from '../../../src/ui-server/jobs.js';
import { SessionStore } from '../../../src/ui-server/session-store.js';
import { loadSession, resolveStartupSource, type Session } from '../../../src/operations/session.js';
import { readConfig } from '../../../src/bundle/cache.js';
import { deleteTokens } from '../../../src/auth/token-store.js';
import type { SessionDto } from '../../../src/ui-server/api-types.js';

vi.mock('../../../src/operations/session.js', async (original) => ({
  ...await original<typeof import('../../../src/operations/session.js')>(),
  resolveStartupSource: vi.fn(), loadSession: vi.fn(), runStartupChecks: vi.fn(async () => ({ notices: [], errors: [] })),
}));
vi.mock('../../../src/auth/token-store.js', async (original) => ({
  ...await original<typeof import('../../../src/auth/token-store.js')>(), deleteTokens: vi.fn(),
}));
const base = 'https://skills.example.com';
const source = (name: string) => ({ type: 'discovery' as const, baseUrl: `${base}/${name}`, discovery: { version: '1' as const, sources: [] } });
function session(name = 'one'): Session {
  return { source: source(name), stored: { kind: 'discovery', value: `${base}/${name}` },
    auth: { required: false, authenticated: false }, membership: { state: 'not-required', projects: [] },
    catalogueScope: { kind: 'unrestricted' }, warnings: [], discoverySkills: [{
      dirName: 'test-skill', dirPath: '/server-owned/skills/test-skill',
      sourceName: 'test', sourceType: 'http', hasSkillMd: true,
    }],
  };
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
let jobs: JobRegistry;
let store: SessionStore;
let changes: SessionDto[];
beforeEach(async () => {
  vi.clearAllMocks();
  await rm(path.join(os.homedir(), '.agentman'), { recursive: true, force: true });
  jobs = new JobRegistry(); changes = [];
  store = new SessionStore(jobs, os.homedir(), (dto) => changes.push(dto));
  vi.mocked(resolveStartupSource).mockImplementation(async (input) => ({ source: source(input!.split('/').pop()!), stored: { kind: 'discovery', value: input! } }));
  vi.mocked(loadSession).mockImplementation(async (startup) => ({ ...session(), ...startup }));
});
afterEach(async () => { await jobs.stop(); });

it('only the newest load publishes and persists its source when loads complete out of order', async () => {
  const slow = barrier(), entered = barrier();
  vi.mocked(loadSession).mockImplementation(async (startup) => {
    if (startup.stored?.value.endsWith('/slow')) { entered.release(); await slow.promise; }
    return { ...session(), ...startup };
  });
  const older = await store.load(`${base}/slow`); await entered.promise;
  const newer = await store.load(`${base}/new`); await jobs.wait(newer);
  expect(store.snapshot()).toMatchObject({ state: 'ready', sessionRevision: 2, stored: { value: `${base}/new` } });
  slow.release(); await jobs.wait(older);
  expect(jobs.get(older)).toMatchObject({ state: 'failed', error: { code: 'STALE_SESSION' } });
  expect((await readConfig()).activeSource?.value).toBe(`${base}/new`);
  expect((await readConfig()).sources).toEqual([{ kind: 'discovery', value: `${base}/new` }]);
  expect(changes.filter((dto) => dto.state === 'ready').map((dto) => dto.sessionRevision)).toEqual([2]);
  expect(resolveStartupSource).toHaveBeenCalledWith(`${base}/slow`, { persist: false });
});

it('membership failure never exposes or accepts an excluded skill', async () => {
  vi.mocked(loadSession).mockResolvedValue({ ...session(), catalogueScope: { kind: 'membership', projects: [] },
    membership: { state: 'error', projects: [], error: 'Membership lookup failed' } });
  const id = await store.load(base); await jobs.wait(id);
  expect(store.snapshot()).toMatchObject({ state: 'ready', catalogue: [], membership: { state: 'error' } });
  await expect(store.candidate(1, 'test-skill', 'test-skill', 'system')).rejects.toMatchObject({ code: 'CANDIDATE_REJECTED' });
});

it('logout waits for auth cleanup and token persistence before deleting tokens', async () => {
  const entered = barrier(), cleanup = barrier();
  const order: string[] = [];
  vi.mocked(resolveStartupSource).mockResolvedValue({ source: {
    ...source('auth'), discovery: { version: '1', sources: [], auth: {
      required: true, oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration', clientId: 'public-test-client',
    } },
  } });
  vi.mocked(loadSession).mockImplementation(async (_startup, options) => {
    await options!.runAuth!(async () => {
      const aborted = new Promise<void>((resolve) => options!.signal!.addEventListener('abort', () => resolve(), { once: true }));
      entered.release(); await aborted; await cleanup.promise;
      order.push('late-token-save');
    });
    return session('auth');
  });
  vi.mocked(deleteTokens).mockImplementation(async () => { order.push('delete'); });
  const id = await store.load(`${base}/auth`); await entered.promise;
  const logout = store.logout();
  await vi.waitFor(() => expect(store.snapshot().sessionRevision).toBe(2));
  expect(deleteTokens).not.toHaveBeenCalled();
  await expect(store.load(base)).rejects.toMatchObject({ code: 'AUTH_BUSY' });
  cleanup.release(); await logout;
  expect(order).toEqual(['late-token-save', 'delete']);
  expect(jobs.get(id).state).toBe('cancelled');
  expect(store.snapshot()).toMatchObject({ state: 'idle', catalogue: [], auth: { authenticated: false } });
  expect(deleteTokens).toHaveBeenCalledWith({ discoveryBaseUrl: `${base}/auth`, oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration', clientId: 'public-test-client' });
});

it('queued installs revalidate the accepted revision before a mutation', async () => {
  const load = await store.load(base); await jobs.wait(load);
  const candidate = await store.candidate(1, 'test-skill', 'test-skill', 'system');
  expect(candidate.skill.dirPath).toContain('/server-owned/');
  const gate = barrier(), entered = barrier();
  const commit = vi.fn();
  const install = jobs.start('install', async (ctx) => {
    entered.release(); await gate.promise; ctx.phase('commit');
    return store.exclusive(async () => { await store.candidate(1, 'test-skill', 'test-skill', 'system'); commit(); return {}; });
  });
  await entered.promise;
  const reload = await store.load(`${base}/new`); await jobs.wait(reload);
  gate.release(); await jobs.wait(install);
  expect(commit).not.toHaveBeenCalled();
  expect(jobs.get(install)).toMatchObject({ state: 'failed', error: { code: 'STALE_SESSION' } });
});

it('DTOs omit discovery auth internals, raw paths, pins and arbitrary session fields', async () => {
  vi.mocked(loadSession).mockResolvedValue({ ...session(), authSession: {
    discoveryBaseUrl: base, auth: { required: true, clientId: 'not-for-the-browser', oidcDiscoveryUrl: 'https://auth.example.com' },
  } });
  const id = await store.load(base); await jobs.wait(id);
  const dto = JSON.stringify(store.snapshot());
  expect(dto).not.toContain('not-for-the-browser'); expect(dto).not.toContain('/server-owned');
  expect(dto).not.toContain('sourcePin'); expect(dto).not.toContain('authSession');
});
