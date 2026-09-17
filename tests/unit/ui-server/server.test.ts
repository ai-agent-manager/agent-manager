import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startUiServer } from '../../../src/ui-server/index.js';
import { readConfig } from '../../../src/bundle/cache.js';
import type { JobDto, SessionDto } from '../../../src/ui-server/api-types.js';

// Fail the test on a transitive renderer import, rather than merely grepping.
vi.mock('ink', () => { throw new Error('UI server imported Ink'); });
let server: Awaited<ReturnType<typeof startUiServer>>;
let directory: string;
let base: string;
let authorization: string;
const fixture = path.resolve('tests/fixtures/valid-bundle');

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'agentman-http-'));
  await mkdir(path.join(directory, '.git'));
  vi.stubEnv('AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS', 'true');
  await rm(path.join(os.homedir(), '.agentman'), { recursive: true, force: true });
  server = await startUiServer({ port: 0, cwd: directory, staticDir: null });
  base = `http://127.0.0.1:${server.port}`; authorization = `Bearer ${server.token}`;
});
afterEach(async () => { await server?.stop(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function api(route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const options: RequestInit = { method, headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${base}${route}`, options);
}
async function job(id: string): Promise<JobDto> {
  let result!: JobDto;
  await vi.waitFor(async () => {
    result = await (await api(`/api/jobs/${id}`)).json();
    expect(['succeeded', 'failed', 'cancelled']).toContain(result.state);
  });
  return result;
}
async function load(): Promise<SessionDto> {
  const response = await api('/api/session/load', 'POST', { source: fixture });
  expect(response.status).toBe(202);
  expect((await job((await response.json()).jobId)).state).toBe('succeeded');
  return (await api('/api/session')).json();
}
function raw(target: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base, { path: target, headers }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (data) => { body += data; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject); req.end();
  });
}

it('binds loopback and enforces bearer, Host, Origin, JSON and response headers', async () => {
  expect(server.server.address()).toMatchObject({ address: '127.0.0.1' });
  const health = await fetch(`${base}/health`);
  expect(await health.json()).toEqual({ status: 'ok' });
  for (const [name, value] of Object.entries({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })) expect(health.headers.get(name)).toBe(value);
  const unauthorized = await fetch(`${base}/api/context`);
  expect(unauthorized.status).toBe(401);
  expect((await unauthorized.json()).error.message).toBe('Open the Web UI URL printed by Agent Manager to authorize this tab.');
  expect((await api('/api/context', 'GET', undefined, { origin: 'https://example.com' })).status).toBe(403);
  expect((await api('/api/context', 'GET', undefined, { origin: `${base}/` })).status).toBe(403);
  expect((await raw('/api/context', { authorization, host: `example.com:${server.port}` })).status).toBe(403);
  expect((await raw('/%61pi/context', {})).status).toBe(401);
  expect((await api('/api/session/load', 'POST', {} , { 'content-type': 'text/plain' })).status).toBe(415);
  expect((await api('/api/context', 'GET', undefined, { origin: base })).status).toBe(200);
  expect((await api('/api/context')).headers.get('access-control-allow-origin')).toBeNull();
  expect((await api('/api/missing')).status).toBe(404);
  expect((await api('/api/settings', 'POST', {})).status).toBe(405);
  expect((await api('/')).status).toBe(503);
});

it('validates malformed, oversized and unknown fields without changing settings', async () => {
  const malformed = await fetch(`${base}/api/settings`, { method: 'PATCH', headers: { authorization, 'content-type': 'application/json' }, body: '{' });
  expect(malformed.status).toBe(400);
  expect((await api('/api/settings', 'PATCH', { extra: true })).status).toBe(400);
  expect((await api('/api/settings', 'PATCH', { telemetryDisabled: 'true' })).status).toBe(400);
  expect((await api('/api/settings', 'PATCH', { telemetryDisabled: true, extra: 'x'.repeat(1024 * 1024) })).status).toBe(413);
  expect((await api('/api/settings?extra=1')).status).toBe(400);
  expect((await api('/api/installs?scope=system&scope=repo')).status).toBe(400);
  expect((await api('/api/settings', 'PATCH', { telemetryDisabled: true })).status).toBe(200);
  expect(await (await api('/api/settings')).json()).toMatchObject({ telemetryDisabled: true });
});

it('loads a real bundle, installs a server-owned candidate, reads it and removes it', async () => {
  const session = await load();
  expect(session.catalogue.map((entry) => entry.skillId)).toEqual(['test-skill']);
  const entry = session.catalogue[0]!;
  expect(JSON.stringify(session)).not.toContain('dirPath');
  expect((await (await api('/api/catalogue/skills/test-skill')).json()).entry.skillId).toBe('test-skill');
  const response = await api('/api/installs', 'POST', { sessionRevision: session.sessionRevision, skillId: entry.skillId,
    installKey: entry.candidates[0]!.installKey, scope: 'system', toolIds: ['claude-code'] });
  expect(response.status).toBe(202);
  const result = await job((await response.json()).jobId);
  expect(result).toMatchObject({ state: 'succeeded', result: { result: { errors: [], installed: [{ name: 'test-skill' }] } } });
  const target = path.join(os.homedir(), '.claude/skills/test-skill');
  expect(await readFile(path.join(target, 'SKILL.md'), 'utf8')).toContain('Test Skill');
  expect((await readConfig()).installations['claude-code']!['test-skill']!.sourcePin?.bundleVersion).toBe(session.bundleVersion);
  expect(await (await api('/api/installs?scope=system')).json()).toMatchObject({ records: [{ skillId: 'test-skill' }] });
  expect((await api('/api/installs/test-skill?scope=system&toolId=claude-code')).status).toBe(200);
  expect((await api('/api/installs/test-skill?scope=system&toolId=claude-code', 'DELETE', {})).status).toBe(200);
  await expect(realpath(target)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects forged candidates, stale revisions, invalid tools, and non-root repositories', async () => {
  const session = await load();
  const body = { sessionRevision: session.sessionRevision, skillId: 'test-skill', installKey: 'test-skill', scope: 'system', toolIds: ['claude-code'] };
  expect((await api('/api/installs', 'POST', { ...body, sourcePin: {} })).status).toBe(400);
  expect((await api('/api/installs', 'POST', { ...body, installKey: 'forged' })).status).toBe(403);
  expect((await api('/api/installs', 'POST', { ...body, sessionRevision: session.sessionRevision - 1 })).status).toBe(409);
  expect((await api('/api/installs', 'POST', { ...body, toolIds: ['missing'] })).status).toBe(400);
  expect((await api('/api/installs', 'POST', { ...body, installKey: '../escape' })).status).toBe(400);
  await mkdir(path.join(directory, 'child'));
  expect((await api('/api/installs', 'POST', { ...body, scope: 'repo', repoRoot: path.join(directory, 'child') })).status).toBe(400);
  expect((await api('/api/installs/%252e%252e?scope=system&toolId=claude-code')).status).toBe(400);
  const repo = await api('/api/installs', 'POST', { ...body, scope: 'repo' });
  expect((await job((await repo.json()).jobId)).state).toBe('succeeded');
  expect(await readFile(path.join(directory, '.claude/skills/test-skill/SKILL.md'), 'utf8')).toContain('Test Skill');
  expect((await (await api('/api/context')).json()).repoRoot).toBe(await realpath(directory));
});

it('manages sources and invalidates the catalogue when active source changes', async () => {
  await load();
  const added = await api('/api/sources', 'POST', { value: 'https://skills.example.com' });
  expect(added.status).toBe(200);
  const sources = await added.json();
  const source = sources.sources.find((entry: { kind: string }) => entry.kind === 'discovery');
  expect((await api('/api/sources/activate', 'POST', source)).status).toBe(200);
  expect(await (await api('/api/session')).json()).toMatchObject({ state: 'idle', catalogue: [] });
  expect((await api('/api/sources/remove', 'POST', source)).status).toBe(200);
  expect((await (await api('/api/sources')).json()).sources).not.toContainEqual(source);
});

it('shows and installs the repository-pinned candidate when the global catalogue has moved on', async () => {
  const source = path.join(directory, 'source'); await cp(fixture, source, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
  const loadVersion = async (version: string) => {
    await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version }));
    const accepted = await api('/api/session/load', 'POST', { source });
    expect((await job((await accepted.json()).jobId)).state).toBe('succeeded');
    return (await (await api('/api/session')).json()).sessionRevision;
  };
  const revision = await loadVersion('1.0.0');
  const first = await api('/api/installs', 'POST', { sessionRevision: revision, skillId: 'test-skill', installKey: 'test-skill', scope: 'repo', toolIds: ['claude-code'] });
  expect((await job((await first.json()).jobId)).state).toBe('succeeded');
  await writeFile(path.join(source, 'test-skill', 'SKILL.md'), '# Next-version content');
  const newer = await loadVersion('2.0.0');
  const global = await (await api('/api/catalogue/skills/test-skill')).json();
  const repo = await (await api('/api/catalogue/skills/test-skill?scope=repo')).json();
  expect(global.entry.candidates[0].version).toBe('2.0.0');
  expect(repo.entry.candidates[0].version).toBe('1.0.0');
  expect(repo.readme).not.toContain('Next-version content');
  const installed = await api('/api/installs', 'POST', { sessionRevision: newer, skillId: 'test-skill', installKey: 'test-skill', scope: 'repo', toolIds: ['cursor'] });
  expect((await job((await installed.json()).jobId)).state).toBe('succeeded');
  const config = JSON.parse(await readFile(path.join(directory, '.agentman.json'), 'utf8'));
  expect(config.installations.cursor['test-skill'].sourcePin.bundleVersion).toBe('1.0.0');
});

it('starts every SSE connection with completed jobs and the authoritative session', async () => {
  const session = await load();
  let previousSequence = 0;
  for (let connection = 0; connection < 2; connection++) {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { headers: { authorization }, signal: controller.signal });
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body!.getReader();
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('event: snapshot\n');
    const sequence = Number(chunk.match(/^id: (\d+)/)![1]);
    expect(sequence).toBeGreaterThan(previousSequence); previousSequence = sequence;
    const snapshot = JSON.parse(chunk.split('data: ')[1]!.split('\n')[0]!);
    expect(snapshot.session.sessionRevision).toBe(session.sessionRevision);
    expect(snapshot.jobs.some((job: JobDto) => job.state === 'succeeded')).toBe(true);
    controller.abort(); await reader.cancel().catch(() => {});
  }
});

it('confines static files, applies CSP and rejects raw traversal and symlink escapes', async () => {
  await server.stop();
  const assets = path.join(directory, 'assets'); await mkdir(assets);
  await writeFile(path.join(assets, 'index.html'), '<!doctype html><p>UI</p>');
  await writeFile(path.join(directory, 'secret.html'), 'not public');
  await symlink(directory, path.join(assets, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  server = await startUiServer({ port: 0, cwd: directory, staticDir: assets });
  base = `http://127.0.0.1:${server.port}`; authorization = `Bearer ${server.token}`;
  const page = await api('/'); expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await api('/escape/secret.html')).status).toBe(403);
  expect((await raw('/%2e%2e/secret.html', {})).status).toBe(400);
  expect((await raw('/%2e%2e%5csecret.html', {})).status).toBe(400);
  expect((await api('/missing.js')).status).toBe(404);
});
