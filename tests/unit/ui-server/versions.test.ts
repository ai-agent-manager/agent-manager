import * as versionOperations from '../../../src/operations/versions.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startUiServer } from '../../../src/ui-server/index.js';
import { importLocalBundle } from '../../../src/bundle/importer.js';
import { getBundleVersionDir } from '../../../src/config/paths.js';
import { readRepoConfig } from '../../../src/bundle/repo-config.js';
import { withMutation } from '../../../src/lib/mutation.js';
import type { BundlesDto, JobDto, SessionDto, RemoteBundlesDto, SkillVersionsDto } from '../../../src/ui-server/api-types.js';

let ui: Awaited<ReturnType<typeof startUiServer>>;
let directory: string, home: string, source: string, repo: string, base: string;
let content: Server | undefined;
let contentUrl: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-version-http-'));
  home = path.join(directory, 'home'); await mkdir(home);
  vi.stubEnv('HOME', home); vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS', 'true');
  source = path.join(directory, 'source'); repo = path.join(directory, 'repo');
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await cp(path.resolve('tests/fixtures/valid-bundle'), source, { recursive: true });
  for (const version of ['1.0.0', '2.0.0']) {
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ version, published: '2026-01-01' }));
    await writeFile(path.join(source, 'test-skill', 'SKILL.md'), `# Test Skill\n${version}`);
    await importLocalBundle(source);
  }
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ version: '1.0.0', published: '2026-01-01' }));
  ui = await startUiServer({ cwd: repo, port: 0, startupSource: source, staticDir: null });
  base = `http://127.0.0.1:${ui.port}`;
  await vi.waitFor(async () => expect((await session()).state).toBe('ready'));
});
afterEach(async () => {
  await ui?.stop();
  if (content) { content.closeAllConnections(); await new Promise<void>((resolve) => content!.close(() => resolve())); content = undefined; }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
});
function api(route: string, method = 'GET', body?: unknown) {
  return fetch(base + route, { method, headers: { authorization: `Bearer ${ui.token}`, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
}
const session = async (): Promise<SessionDto> => (await api('/api/session')).json();
const bundles = async (): Promise<BundlesDto> => (await api('/api/bundles')).json();
async function finished(jobId: string): Promise<JobDto> {
  let job!: JobDto;
  await vi.waitFor(async () => { job = await (await api(`/api/jobs/${jobId}`)).json(); expect(['succeeded', 'failed', 'cancelled']).toContain(job.state); });
  return job;
}
async function install(scope: 'system' | 'repo') {
  const state = await session();
  const response = await api('/api/installs', 'POST', { sessionRevision: state.sessionRevision, skillId: 'test-skill', installKey: 'test-skill', scope, toolIds: ['claude-code'], ...(scope === 'repo' ? { repoRoot: repo } : {}) });
  expect((await finished((await response.json()).jobId)).state).toBe('succeeded');
}
it('selects a verified global bundle and publishes its catalogue without redownloading', async () => {
  await install('system');
  const state = await session();
  const cached = (await bundles()).cached;
  expect(cached).toHaveLength(2);
  expect(JSON.stringify(cached)).not.toContain('bundleDir');
  const selected = cached.find((entry) => entry.version === '2.0.0')!;
  expect(selected.canSelect).toBe(true);
  const response = await api('/api/bundles/current', 'POST', { sessionRevision: state.sessionRevision, bundleId: selected.bundleId, syncInstalled: false });
  expect(response.status).toBe(202);
  expect(await finished((await response.json()).jobId)).toMatchObject({ state: 'succeeded', result: { failures: [] } });
  expect(await session()).toMatchObject({ state: 'ready', bundleVersion: '2.0.0', sessionRevision: state.sessionRevision + 1 });
  expect(await realpath(path.join(home, '.agentman', 'current'))).toBe(getBundleVersionDir('2.0.0'));
  expect(await realpath(path.join(home, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('1.0.0'), 'test-skill'));
});
it('selects the exact repository instance and protects referenced and current bundles', async () => {
  await install('repo'); await install('system');
  const instances = await (await api(`/api/skill-versions?${new URLSearchParams({ repoRoot: repo })}`)).json();
  expect(instances.instances).toHaveLength(2);
  const query = new URLSearchParams({ scope: 'repo', toolId: 'claude-code', repoRoot: repo });
  const available: SkillVersionsDto = await (await api(`/api/skill-versions/test-skill/available?${query}`)).json();
  expect(available.supported).toBe(true);
  const target = available.bundles.find((entry) => entry.version === '2.0.0')!;
  const response = await api('/api/skill-versions', 'PUT', { sessionRevision: (await session()).sessionRevision, installKey: 'test-skill', scope: 'repo', toolId: 'claude-code', repoRoot: repo, bundleId: target.bundleId });
  expect((await finished((await response.json()).jobId)).state).toBe('succeeded');
  expect((await readRepoConfig(repo))!.installations['claude-code']['test-skill'].sourcePin?.bundleVersion).toBe('2.0.0');
  expect(await realpath(path.join(repo, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('2.0.0'), 'test-skill'));
  expect(await realpath(path.join(home, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('1.0.0'), 'test-skill'));
  expect((await api(`/api/bundles/${target.bundleId}`, 'DELETE')).status).toBe(409);
  const current = (await bundles()).cached.find((entry) => entry.isCurrent)!;
  expect((await api(`/api/bundles/${current.bundleId}`, 'DELETE')).status).toBe(409);
});
it('rejects forged IDs, stale revisions, unknown fields and non-repository roots', async () => {
  const id = (await bundles()).cached[0]!.bundleId;
  expect((await api('/api/bundles/current', 'POST', { sessionRevision: 0, bundleId: id, syncInstalled: false })).status).toBe(409);
  expect((await api('/api/bundles/download', 'POST', { sessionRevision: (await session()).sessionRevision, bundleId: 'a'.repeat(64) })).status).toBe(409);
  expect((await api('/api/bundles/current', 'POST', { sessionRevision: 1, bundleId: '../escape', syncInstalled: false })).status).toBe(400);
  expect((await api('/api/bundles/download', 'POST', { sessionRevision: 1, bundleId: id, version: '2.0.0' })).status).toBe(400);
  expect((await api(`/api/skill-versions?${new URLSearchParams({ repoRoot: source })}`)).status).toBe(400);
  expect((await api('/api/bundles/%2e%2e%2fescape', 'DELETE')).status).toBe(400);
});
it('removes only an unused verified cache and rejects a repeated stale selection', async () => {
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  expect((await api(`/api/bundles/${target.bundleId}`, 'DELETE')).status).toBe(200);
  expect((await api(`/api/bundles/${target.bundleId}`, 'DELETE')).status).toBe(409);
  expect((await bundles()).cached.map((entry) => entry.version)).toEqual(['1.0.0']);
});
it('revalidates queued switches after a newer session load is accepted', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const revision = (await session()).sessionRevision;
  const holder = withMutation(async () => { enter(); await held; }); await entered;
  try {
    const response = await api('/api/bundles/current', 'POST', { sessionRevision: revision, bundleId: target.bundleId, syncInstalled: false });
    const { jobId } = await response.json();
    expect((await api('/api/session/load', 'POST', { source })).status).toBe(202);
    release(); await holder;
    expect(await finished(jobId)).toMatchObject({ state: 'failed', error: { code: 'STALE_SESSION' } });
  } finally { release(); await holder; }
});
it('downloads named-source remote versions without activating them as global bundles', async () => {
  const archive = await readFile(path.resolve('mocks/agents/0.1.1/bundle.zip'));
  content = createServer((req, res) => {
    if (req.url === '/.well-known/agents/discovery.json') { res.end(JSON.stringify({ version: '1', sources: [{ name: 'test-named', type: 'http', url: `${contentUrl}/agents` }] })); return; }
    if (req.url === '/agents/index.json') { res.end(JSON.stringify({ lastUpdated: '2026-01-01', agents: [{ version: '0.1.1', published: '2026-01-01' }] })); return; }
    if (req.url === '/agents/0.1.1/bundle.zip') { res.end(archive); return; }
    if (req.url === '/agents/0.1.1/bundle.zip.sha256') { res.end(createHash('sha256').update(archive).digest('hex')); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => content!.listen(0, '127.0.0.1', resolve));
  contentUrl = `http://127.0.0.1:${(content.address() as { port: number }).port}`;
  const load = await api('/api/session/load', 'POST', { source: contentUrl });
  expect((await finished((await load.json()).jobId)).state).toBe('succeeded');
  const remote: RemoteBundlesDto = await (await api('/api/bundles/remote')).json();
  expect(remote.bundles).toHaveLength(1);
  expect(remote.bundles[0].source.name).toBe('test-named');
  const response = await api('/api/bundles/download', 'POST', { sessionRevision: remote.sessionRevision, bundleId: remote.bundles[0].bundleId });
  expect((await finished((await response.json()).jobId)).state).toBe('succeeded');
  const named = (await bundles()).cached.find((entry) => entry.cacheKind === 'named')!;
  expect(named).toMatchObject({ version: '0.1.1', canSelect: false, canRemove: false, isCurrent: false });
  expect(named.removalReason).toContain('live catalogue');
  const remove = await api(`/api/bundles/${named.removalId}`, 'DELETE');
  expect(remove.status).toBe(409);
  expect(await remove.json()).toMatchObject({ error: { code: 'BUNDLE_IN_USE' } });
  expect((await bundles()).cached.find((entry) => entry.cacheKind === 'flat')!.reason).toContain('per installed skill');
  expect((await bundles()).current).toBe('1.0.0');
  const select = await api('/api/bundles/current', 'POST', { sessionRevision: remote.sessionRevision, bundleId: named.bundleId, syncInstalled: false });
  expect(await finished((await select.json()).jobId)).toMatchObject({ state: 'failed', error: { code: 'UNSUPPORTED_BUNDLE' } });
});

it('reports partial sync failures while keeping the new catalogue selected', async () => {
  const oldOnly = path.join(getBundleVersionDir('1.0.0'), 'old-only');
  await mkdir(oldOnly); await writeFile(path.join(oldOnly, 'SKILL.md'), '# Old only');
  const reload = await api('/api/session/load', 'POST', { source });
  await finished((await reload.json()).jobId);
  const revision = (await session()).sessionRevision;
  const install = await api('/api/installs', 'POST', { sessionRevision: revision, skillId: 'old-only', installKey: 'old-only', scope: 'system', toolIds: ['claude-code'] });
  expect((await finished((await install.json()).jobId)).state).toBe('succeeded');
  const next = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const response = await api('/api/bundles/current', 'POST', { sessionRevision: revision, bundleId: next.bundleId, syncInstalled: true, repoRoot: repo });
  expect(await finished((await response.json()).jobId)).toMatchObject({ state: 'succeeded', result: { failures: [expect.stringContaining('old-only')] } });
  expect((await session()).bundleVersion).toBe('2.0.0');
  expect(await realpath(path.join(home, '.claude/skills/old-only'))).toBe(oldOnly);
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
it('reports a switch superseded during sync without publishing over the newer load', async () => {
  await install('system');
  const selected = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const revision = (await session()).sessionRevision;
  const entered = barrier(), release = barrier();
  const actual = versionOperations.selectBundle;
  vi.spyOn(versionOperations, 'selectBundle').mockImplementationOnce(async (...args) => {
    const result = await actual(...args); entered.release(); await release.promise; return result;
  });
  const response = await api('/api/bundles/current', 'POST', { sessionRevision: revision, bundleId: selected.bundleId, syncInstalled: true });
  const { jobId } = await response.json();
  await entered.promise;
  try {
    const load = await api('/api/session/load', 'POST', { source });
    const next = await load.json();
    expect(load.status).toBe(202);
    release.release();
    expect(await finished(jobId)).toMatchObject({ state: 'succeeded', result: { failures: [], superseded: true } });
    expect((await finished(next.jobId)).state).toBe('succeeded');
    expect(await session()).toMatchObject({ bundleVersion: '1.0.0', sessionRevision: revision + 1 });
    expect(await realpath(path.join(home, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('2.0.0'), 'test-skill'));
  } finally { release.release(); }
});
it('removes unused unattested caches without allowing them to be selected', async () => {
  await rm(path.join(getBundleVersionDir('2.0.0'), '.source.json'));
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  expect(target).toMatchObject({ canSelect: false, canRemove: true });
  expect(target.bundleId).toBeUndefined(); expect(target.removalId).toMatch(/^[a-f0-9]{64}$/);
  expect((await api(`/api/bundles/${target.removalId}`, 'DELETE')).status).toBe(200);
  expect((await api(`/api/bundles/${target.removalId}`, 'DELETE')).status).toBe(409);
});
it('requires removing a legacy installation before deleting its unattested cache', async () => {
  await install('system');
  const current = (await bundles()).cached.find((entry) => entry.version === '1.0.0')!;
  const next = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const switchResponse = await api('/api/bundles/current', 'POST', { sessionRevision: (await session()).sessionRevision, bundleId: next.bundleId, syncInstalled: false });
  await finished((await switchResponse.json()).jobId);
  await rm(path.join(getBundleVersionDir('1.0.0'), '.source.json'));
  const legacy = (await bundles()).cached.find((entry) => entry.version === current.version)!;
  const rejected = await api(`/api/bundles/${legacy.removalId}`, 'DELETE');
  expect(rejected.status).toBe(409); expect((await rejected.json()).error.message).toContain('Remove or switch the installation first');
  expect((await api('/api/installs/test-skill?scope=system&toolId=claude-code', 'DELETE')).status).toBe(200);
  expect((await api(`/api/bundles/${legacy.removalId}`, 'DELETE')).status).toBe(200);
});
it('rejects forged, other-origin and missing-skill version IDs before accepting a job', async () => {
  await install('system');
  const request = { sessionRevision: (await session()).sessionRevision, installKey: 'test-skill', toolId: 'claude-code', scope: 'system' };
  const forged = await api('/api/skill-versions', 'PUT', { ...request, bundleId: 'a'.repeat(64) });
  expect(forged.status).toBe(409); expect(await forged.json()).toMatchObject({ error: { code: 'STALE_BUNDLE' } });
  const marker = path.join(getBundleVersionDir('2.0.0'), '.source.json');
  const original = await readFile(marker, 'utf8');
  await writeFile(marker, JSON.stringify({ contentRoot: 'https://other.example.com/agents' }));
  const foreign = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  expect((await api('/api/skill-versions', 'PUT', { ...request, bundleId: foreign.bundleId })).status).toBe(409);
  await writeFile(marker, original);
  await rm(path.join(getBundleVersionDir('2.0.0'), 'test-skill'), { recursive: true });
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const missing = await api('/api/skill-versions', 'PUT', { ...request, bundleId: target.bundleId });
  expect(missing.status).toBe(409); expect(await missing.json()).toMatchObject({ error: { code: 'SKILL_UNAVAILABLE' } });
});
it('revalidates a queued per-skill switch after a reload and leaves the install unchanged', async () => {
  await install('system');
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const revision = (await session()).sessionRevision;
  const entered = barrier(), release = barrier();
  const owner = withMutation(async () => { entered.release(); await release.promise; }); await entered.promise;
  try {
    const response = await api('/api/skill-versions', 'PUT', { sessionRevision: revision, bundleId: target.bundleId, installKey: 'test-skill', toolId: 'claude-code', scope: 'system' });
    expect(response.status).toBe(202);
    const { jobId } = await response.json();
    expect((await api('/api/session/load', 'POST', { source })).status).toBe(202);
    release.release(); await owner;
    expect(await finished(jobId)).toMatchObject({ state: 'failed', error: { code: 'STALE_SESSION' } });
    expect(await realpath(path.join(home, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('1.0.0'), 'test-skill'));
  } finally { release.release(); await owner; }
});
it('omitting the optional sync repository changes only personal installations', async () => {
  await install('repo'); await install('system');
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const response = await api('/api/bundles/current', 'POST', { sessionRevision: (await session()).sessionRevision, bundleId: target.bundleId, syncInstalled: true });
  expect((await finished((await response.json()).jobId)).state).toBe('succeeded');
  expect(await realpath(path.join(home, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('2.0.0'), 'test-skill'));
  expect(await realpath(path.join(repo, '.claude/skills/test-skill'))).toBe(path.join(getBundleVersionDir('1.0.0'), 'test-skill'));
});

async function remoteFixture() {
  const archives = new Map(await Promise.all(['0.1.0', '0.1.1'].map(async (version) => [version, await readFile(path.resolve(version === '0.1.0' ? 'tests/fixtures/version-bundle.zip' : 'mocks/agents/0.1.1/bundle.zip'))] as const)));
  const controls = { latest: '0.1.0', manifestVersion: '0.1.1', root: '/agents', onZip: async () => {} };
  content = createServer((req, res) => { void (async () => {
    if (req.url === '/.well-known/agents/discovery.json') return res.end(JSON.stringify({ version: '1', sources: [{ name: 'remote', type: 'http', url: `${contentUrl}${controls.root}` }] }));
    if (req.url?.endsWith('/index.json')) return res.end(JSON.stringify({ lastUpdated: '2026-01-01', agents: [{ version: controls.latest, published: '2026-01-01' }] }));
    const archive = archives.get(req.url?.includes('/0.1.0/') ? '0.1.0' : controls.manifestVersion)!;
    if (req.url?.endsWith('/bundle.zip.sha256')) return res.end(createHash('sha256').update(archive).digest('hex'));
    if (req.url?.endsWith('/bundle.zip')) { await controls.onZip(); return res.end(archive); }
    res.writeHead(404).end();
  })().catch(() => res.destroy()); });
  await new Promise<void>((resolve) => content!.listen(0, '127.0.0.1', resolve));
  contentUrl = `http://127.0.0.1:${(content.address() as { port: number }).port}`;
  const loaded = await api('/api/session/load', 'POST', { source: contentUrl });
  expect((await finished((await loaded.json()).jobId)).state).toBe('succeeded');
  controls.latest = '0.1.1';
  return controls;
}
it('rejects a download superseded during network I/O before publishing its cache', async () => {
  const remote = await remoteFixture();
  const choices: RemoteBundlesDto = await (await api('/api/bundles/remote')).json();
  const entered = barrier(), release = barrier();
  remote.onZip = async () => { entered.release(); await release.promise; };
  const response = await api('/api/bundles/download', 'POST', { sessionRevision: choices.sessionRevision, bundleId: choices.bundles[0].bundleId });
  const { jobId } = await response.json(); await entered.promise;
  try {
    const loaded = await api('/api/session/load', 'POST', { source });
    expect((await finished((await loaded.json()).jobId)).state).toBe('succeeded');
    release.release();
    expect(await finished(jobId)).toMatchObject({ state: 'failed', error: { code: 'STALE_SESSION' } });
    expect((await bundles()).cached.some((entry) => entry.version === '0.1.1')).toBe(false);
  } finally { release.release(); }
});
it('rejects a remote index whose archive declares a different version', async () => {
  const remote = await remoteFixture(); remote.manifestVersion = '0.1.0';
  const choices: RemoteBundlesDto = await (await api('/api/bundles/remote')).json();
  const response = await api('/api/bundles/download', 'POST', { sessionRevision: choices.sessionRevision, bundleId: choices.bundles[0].bundleId });
  expect(await finished((await response.json()).jobId)).toMatchObject({ state: 'failed', error: { code: 'OPERATION_CONFLICT', message: expect.stringContaining('manifest does not match') } });
  expect((await bundles()).cached.some((entry) => entry.version === '0.1.1')).toBe(false);
});
it('exposes source-name collisions as an actionable conflict without a cache path', async () => {
  const remote = await remoteFixture(); remote.root = '/other';
  const loaded = await api('/api/session/load', 'POST', { source: contentUrl });
  await finished((await loaded.json()).jobId);
  const choices: RemoteBundlesDto = await (await api('/api/bundles/remote')).json();
  const response = await api('/api/bundles/download', 'POST', { sessionRevision: choices.sessionRevision, bundleId: choices.bundles[0].bundleId });
  const job = await finished((await response.json()).jobId);
  expect(job).toMatchObject({ state: 'failed', error: { code: 'OPERATION_CONFLICT', message: expect.stringContaining('rename one of the sources') } });
  expect(job.error!.message).not.toContain(home);
});
it('times out all synchronous mutation waiters before the socket deadline and never applies them later', async () => {
  await install('system');
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const settings = await (await api('/api/settings')).json();
  const entered = barrier(), release = barrier();
  const owner = withMutation(async () => { entered.release(); await release.promise; }); await entered.promise;
  try {
    const responses = await Promise.all([
      api(`/api/bundles/${target.removalId}`, 'DELETE'),
      api('/api/installs/test-skill?scope=system&toolId=claude-code', 'DELETE'),
      api('/api/settings', 'PATCH', { telemetryDisabled: !settings.telemetryDisabled }),
      api('/api/sources', 'POST', { value: 'https://unused.example.com', activate: false }),
    ]);
    for (const response of responses) { expect(response.status).toBe(409); expect((await response.json()).error.message).toContain('Retry'); }
  } finally { release.release(); await owner; }
  expect((await bundles()).cached.some((entry) => entry.version === '2.0.0')).toBe(true);
  expect((await (await api('/api/settings')).json()).telemetryDisabled).toBe(settings.telemetryDisabled);
  expect((await (await api('/api/sources')).json()).sources.some((entry: { value: string }) => entry.value === 'https://unused.example.com')).toBe(false);
  expect((await api('/api/installs/test-skill?scope=system&toolId=claude-code')).status).toBe(200);
}, 15_000);
it('discards a disconnected mutation waiter while the lock is still held', async () => {
  const target = (await bundles()).cached.find((entry) => entry.version === '2.0.0')!;
  const entered = barrier(), release = barrier();
  const owner = withMutation(async () => { entered.release(); await release.promise; }); await entered.promise;
  const abort = new AbortController();
  const response = fetch(base + `/api/bundles/${target.removalId}`, { method: 'DELETE', headers: { authorization: `Bearer ${ui.token}`, 'content-type': 'application/json' }, body: '{}', signal: abort.signal }).catch(() => undefined);
  const owners = () => readdir(path.join(home, '.agentman/mutation.lock'));
  try {
    await vi.waitFor(async () => expect(await owners()).toHaveLength(2));
    abort.abort(); await response;
    await vi.waitFor(async () => expect(await owners()).toHaveLength(1));
  } finally { abort.abort(); release.release(); await owner; }
  expect((await bundles()).cached.some((entry) => entry.version === '2.0.0')).toBe(true);
});

it('never issues a removal identity for the reserved named-cache container', async () => {
  const container = path.join(home, '.agentman/bundles/sources');
  await mkdir(container, { recursive: true });
  await writeFile(path.join(container, 'manifest.json'), JSON.stringify({ version: 'sources', published: '2026-01-01' }));
  const entry = (await bundles()).cached.find((entry) => entry.version === 'sources')!;
  expect(entry.canRemove).toBe(false);
  expect(entry.removalId).toBeUndefined();
});
