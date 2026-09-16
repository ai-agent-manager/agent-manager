import { withMutation } from '../../../src/lib/mutation.js';
import { updateInstalled } from '../../../src/operations/manage.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startUiServer } from '../../../src/ui-server/index.js';
import { installResolvedSkills } from '../../../src/operations/install.js';
import { loadSession } from '../../../src/operations/session.js';
import type { SessionDto } from '../../../src/ui-server/api-types.js';

vi.mock('../../../src/operations/manage.js', async (original) => ({
  ...await original<typeof import('../../../src/operations/manage.js')>(), updateInstalled: vi.fn(),
}));
vi.mock('../../../src/operations/install.js', async (original) => ({
  ...await original<typeof import('../../../src/operations/install.js')>(), installResolvedSkills: vi.fn(),
}));
vi.mock('../../../src/operations/session.js', async (original) => ({
  ...await original<typeof import('../../../src/operations/session.js')>(), loadSession: vi.fn(),
}));
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
let server: Awaited<ReturnType<typeof startUiServer>>;
let cwd: string;
let base: string;
let authorization: string;
const fixture = path.resolve('tests/fixtures/valid-bundle');
beforeEach(async () => {
  vi.stubEnv('AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS', 'true');
  cwd = await mkdtemp(path.join(os.tmpdir(), 'agentman-http-life-'));
  await rm(path.join(os.homedir(), '.agentman'), { recursive: true, force: true });
  const actual = await vi.importActual<typeof import('../../../src/operations/session.js')>('../../../src/operations/session.js');
  vi.mocked(loadSession).mockImplementation(actual.loadSession);
  server = await startUiServer({ port: 0, cwd, startupSource: fixture, staticDir: null });
  base = `http://127.0.0.1:${server.port}`; authorization = `Bearer ${server.token}`;
  await vi.waitFor(async () => expect((await (await api('/api/session')).json()).state).toBe('ready'));
});
afterEach(async () => { await server.stop(); vi.unstubAllEnvs(); await rm(cwd, { recursive: true, force: true }); });
function api(route: string, body?: unknown) {
  const options: RequestInit = { headers: { authorization } };
  if (body !== undefined) { options.method = 'POST'; options.headers = { authorization, 'content-type': 'application/json' }; options.body = JSON.stringify(body); }
  return fetch(`${base}${route}`, options);
}
async function stream() {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { authorization }, signal: controller.signal });
  const reader = response.body!.getReader();
  let text = '';
  const read = async () => {
    while (!text.includes('\n\n')) {
      const chunk = await reader.read(); if (chunk.done) throw new Error('Stream closed before event');
      text += new TextDecoder().decode(chunk.value);
    }
    const index = text.indexOf('\n\n'); const frame = text.slice(0, index); text = text.slice(index + 2);
    return { event: frame.match(/event: (.+)/)![1], data: JSON.parse(frame.split('data: ')[1]!) };
  };
  return { read, close: async () => { controller.abort(); await reader.cancel().catch(() => {}); } };
}

it('shutdown drains a real installation and publishes its terminal state before closing SSE', async () => {
  const entered = barrier(), release = barrier();
  const actual = await vi.importActual<typeof import('../../../src/operations/install.js')>('../../../src/operations/install.js');
  vi.mocked(installResolvedSkills).mockImplementation(async (options) => {
    entered.release(); await release.promise;
    return actual.installResolvedSkills(options);
  });
  const events = await stream(); expect((await events.read()).event).toBe('snapshot');
  const session: SessionDto = await (await api('/api/session')).json();
  const accepted = await api('/api/installs', { sessionRevision: session.sessionRevision, skillId: 'test-skill', installKey: 'test-skill', scope: 'system', toolIds: ['claude-code'] });
  const { jobId } = await accepted.json(); await entered.promise;
  let stopped = false;
  const stopping = server.stop().then(() => { stopped = true; });
  expect((await api('/api/settings', { telemetryDisabled: true })).status).toBe(503);
  expect(stopped).toBe(false);
  release.release();
  let terminal = false;
  while (!terminal) {
    const frame = await events.read();
    terminal = frame.event === 'job' && frame.data.id === jobId && frame.data.state === 'succeeded';
  }
  await events.close(); await stopping;
  expect(await readFile(path.join(os.homedir(), '.claude/skills/test-skill/SKILL.md'), 'utf8')).toContain('Test Skill');
});

it('stop cancels authentication promptly and waits for its asynchronous cleanup', async () => {
  const entered = barrier(), cleanup = barrier();
  vi.mocked(loadSession).mockImplementation(async (_startup, options) => {
    await options!.runAuth!(async () => {
      const aborted = new Promise<void>((resolve) => options!.signal!.addEventListener('abort', () => resolve(), { once: true }));
      entered.release(); await aborted; await cleanup.promise;
    });
    throw new Error('Cancelled authentication continued');
  });
  const events = await stream(); await events.read();
  const { jobId } = await (await api('/api/session/load', { source: fixture })).json(); await entered.promise;
  let stopped = false;
  const stopping = server.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  cleanup.release();
  let terminal = false;
  while (!terminal) {
    const frame = await events.read();
    terminal = frame.event === 'job' && frame.data.id === jobId && frame.data.state === 'cancelled';
  }
  await events.close(); await stopping;
});

it('a reconnect snapshot includes a job which finished while the client was disconnected', async () => {
  const first = await stream(); await first.read(); await first.close();
  const { jobId } = await (await api('/api/session/load', { source: fixture })).json();
  await vi.waitFor(async () => expect((await (await api(`/api/jobs/${jobId}`)).json()).state).toBe('succeeded'));
  const second = await stream();
  const snapshot = await second.read();
  expect(snapshot.event).toBe('snapshot');
  expect(snapshot.data.jobs).toContainEqual(expect.objectContaining({ id: jobId, state: 'succeeded' }));
  await second.close();
});

it('accepts a load promptly while an install holds the mutation lock and queues its own update', async () => {
  const actual = await vi.importActual<typeof import('../../../src/operations/install.js')>('../../../src/operations/install.js');
  vi.mocked(installResolvedSkills).mockImplementation(actual.installResolvedSkills);
  const session: SessionDto = await (await api('/api/session')).json();
  const body = { sessionRevision: session.sessionRevision, skillId: 'test-skill', installKey: 'test-skill', scope: 'system', toolIds: ['claude-code'] };
  const first = await (await api('/api/installs', body)).json();
  await vi.waitFor(async () => expect((await (await api(`/api/jobs/${first.jobId}`)).json()).state).toBe('succeeded'));
  const entered = barrier(), release = barrier(), updateWaiting = barrier();
  vi.mocked(installResolvedSkills).mockImplementation(async (options) => { entered.release(); await release.promise; return actual.installResolvedSkills(options); });
  let updateRan = false, waits = 0;
  vi.mocked(updateInstalled).mockImplementation(async () => withMutation(async () => {
    updateRan = true; return { installed: [], errors: [] };
  }, { timeoutMs: 1, onWait: () => { if (++waits >= 2) updateWaiting.release(); } }));
  const install = await (await api('/api/installs', body)).json();
  await entered.promise;
  try {
    const update = await (await api('/api/installs/test-skill/update', { scope: 'system', toolId: 'claude-code' })).json();
    await updateWaiting.promise;
    expect(updateRan).toBe(false);
    // A load must return its job ID before the held install is released.
    const loaded = await api('/api/session/load', { source: fixture });
    expect(loaded.status).toBe(202);
    expect((await loaded.json()).jobId).toBeTruthy();
    release.release();
    await vi.waitFor(async () => expect((await (await api(`/api/jobs/${update.jobId}`)).json()).state).toBe('succeeded'));
    await vi.waitFor(async () => expect((await (await api(`/api/jobs/${install.jobId}`)).json()).state).toBe('succeeded'));
    expect(updateRan).toBe(true);
  } finally { release.release(); }
});

it('gives a bad startup source an actionable error and settles membership loading', async () => {
  const { jobId } = await (await api('/api/session/load', { source: path.join(cwd, 'missing') })).json();
  await vi.waitFor(async () => expect((await (await api(`/api/jobs/${jobId}`)).json()).state).toBe('failed'));
  const session: SessionDto = await (await api('/api/session')).json();
  expect(session.error).toMatchObject({ code: 'SOURCE_LOAD_FAILED', message: expect.stringContaining('Sources') });
  expect(session.error!.message).not.toContain(cwd);
  expect(session.membership.state).toBe('not-required');
});
