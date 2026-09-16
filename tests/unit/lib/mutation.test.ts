import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withMutation } from '../../../src/lib/mutation.js';
import { createSkillProvisioner } from '../../../src/provisioners/registry.js';
import { readConfig, updateSkillVersion } from '../../../src/bundle/cache.js';
import { buildSourcePin } from '../../../src/bundle/skill-source.js';

let home: string;
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
vi.mock('../../../src/lib/platform.js', async (original) => ({
  ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => home,
}));
const children: ChildProcess[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function child(operation: string, value: string) {
  const proc = fork(fileURLToPath(new URL('../../fixtures/mutation-worker.ts', import.meta.url)), [operation, value], {
    execArgv: ['--import', 'tsx'], env: { ...process.env, HOME: home, USERPROFILE: home, AGENTMAN_TELEMETRY: 'off' }, silent: true,
  });
  children.push(proc);
  const messages: unknown[] = [];
  let stderr = '';
  proc.stderr?.on('data', (data) => { stderr += data; });
  proc.on('message', (message) => messages.push(message));
  return { proc, messages, wait: async (predicate: (message: unknown) => boolean) => {
    await vi.waitFor(() => {
      if (proc.exitCode !== null && !messages.some(predicate)) throw new Error(stderr || `Child exited: ${JSON.stringify(messages)}`);
      expect(messages.some(predicate)).toBe(true);
    }, { timeout: 10_000, interval: 20 });
  } };
}
beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentman-mutation-')); });
afterEach(async () => {
  for (const proc of children.splice(0)) { if (proc.exitCode === null) proc.kill(); }
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

it('serializes independent work, allows awaited nesting, and releases on rejection', async () => {
  const entered = deferred(); const release = deferred(); const waiting = deferred();
  const order: string[] = [];
  const first = withMutation(async () => {
    await withMutation(async () => { order.push('nested'); });
    entered.resolve(); await release.promise; throw new Error('failure');
  });
  // Attach rejection handler before releasing the barrier.
  const rejected = expect(first).rejects.toThrow('failure');
  await entered.promise;
  const second = withMutation(async () => { order.push('second'); }, { onWait: waiting.resolve });
  await waiting.promise;
  expect(order).toEqual(['nested']);
  release.resolve(); await rejected; await second;
  expect(order).toEqual(['nested', 'second']);
  expect(await fs.readdir(path.join(home, '.agentman', 'mutation.lock'))).toEqual([]);
});

it('queues local mutations beyond the external-owner timeout', async () => {
  const entered = deferred(), release = deferred(), waitedTwice = deferred();
  const holder = withMutation(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  let waits = 0, ran = false;
  const next = withMutation(async () => { ran = true; }, { timeoutMs: 1, onWait: () => { if (++waits >= 2) waitedTwice.resolve(); } });
  try { await waitedTwice.promise; expect(ran).toBe(false); }
  finally { release.resolve(); await holder; await next; }
  expect(ran).toBe(true);
});

it('fails closed on malformed ownership without removing the lock', async () => {
  await fs.mkdir(path.join(home, '.agentman'));
  const lock = path.join(home, '.agentman', 'mutation.lock');
  await fs.writeFile(lock, 'invalid');
  await expect(withMutation(async () => {})).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(lock, 'utf8')).toBe('invalid');
});

it('a separate process cannot remove an install between link creation and record publication', async () => {
  const source = path.join(home, 'source');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'SKILL.md'), '# Skill');
  const entered = deferred(); const release = deferred();
  const symlink = fs.symlink;
  vi.spyOn(fs, 'symlink').mockImplementation(async (...args) => {
    await symlink(...args); entered.resolve(); await release.promise;
  });
  const provisioner = createSkillProvisioner('claude-code');
  const installing = provisioner.install([{ dirName: 'skill', dirPath: source, skillMdPath: path.join(source, 'SKILL.md') }], '1.0.0');
  await entered.promise;
  const other = child('remove', 'skill');
  try {
    await other.wait((message) => message === 'waiting');
    expect(other.messages).not.toContain('entered');
    expect((await readConfig()).installations).toEqual({});
  } finally { release.resolve(); }
  expect((await installing).errors).toEqual([]);
  await other.wait((message) => message === 'done');
  expect((await readConfig()).installations['claude-code']?.skill).toBeUndefined();
  await expect(fs.lstat(path.join(provisioner.getEffectiveSkillsDir(), 'skill'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('a separate process cannot delete the switch target before the new pin is published', async () => {
  const pin = buildSourcePin({ type: 'bundle', baseUrl: 'https://skills.example.com/agents', installLayout: 'flat' }, '1.0.0');
  for (const version of ['1.0.0', '2.0.0']) {
    const dir = path.join(home, '.agentman', 'bundles', version);
    await fs.mkdir(path.join(dir, 'skill'), { recursive: true });
    await fs.writeFile(path.join(dir, 'skill', 'SKILL.md'), `# ${version}`);
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version, published: '2026-01-01' }));
    await fs.writeFile(path.join(dir, '.source.json'), JSON.stringify({ contentRoot: pin.bundleBaseUrl, trackedReferences: true }));
  }
  const first = path.join(home, '.agentman', 'bundles', '1.0.0', 'skill');
  const second = path.join(home, '.agentman', 'bundles', '2.0.0', 'skill');
  const provisioner = createSkillProvisioner('claude-code');
  await provisioner.install([{ dirName: 'skill', dirPath: first, skillMdPath: path.join(first, 'SKILL.md') }], '1.0.0', pin);
  const entered = deferred(); const release = deferred();
  const rename = fs.rename;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    await rename(from, to);
    if (String(from).includes('.stage-')) { entered.resolve(); await release.promise; }
  });
  const switching = updateSkillVersion('claude-code', 'skill', '2.0.0');
  await entered.promise;
  const other = child('delete', '2.0.0');
  try {
    await other.wait((message) => message === 'waiting');
    expect(other.messages).not.toContain('entered');
    expect((await readConfig()).installations['claude-code'].skill.sourcePin?.bundleVersion).toBe('1.0.0');
  } finally { release.resolve(); }
  expect(await switching).toEqual({ success: true });
  await other.wait((message) => typeof message === 'object' && message !== null && 'statusCode' in message && message.statusCode === 409);
  expect(await fs.realpath(path.join(provisioner.getEffectiveSkillsDir(), 'skill'))).toBe(second);
  expect((await readConfig()).installations['claude-code'].skill.sourcePin?.bundleVersion).toBe('2.0.0');
});

it.each(['SIGINT', 'SIGKILL'] as const)('recovers after a real owner receives %s', async (signal) => {
  const other = child('hold', '');
  await other.wait((message) => message === 'entered');
  const exited = new Promise<void>((resolve) => other.proc.once('exit', () => resolve()));
  other.proc.kill(signal);
  await exited;
  let ran = false;
  await withMutation(async () => { ran = true; });
  expect(ran).toBe(true);
  expect(await fs.readdir(path.join(home, '.agentman', 'mutation.lock'))).toEqual([]);
});

it.each(['empty', 'malformed', 'recycled-pid'])('recovers an expired %s claim without manual cleanup', async (kind) => {
  const dir = path.join(home, '.agentman', 'mutation.lock');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'old-owner.json');
  await fs.writeFile(file, kind === 'empty' ? '' : kind === 'malformed' ? '{' : JSON.stringify({ pid: process.pid, ticket: 1, token: 'old-owner' }));
  await fs.utimes(file, new Date(0), new Date(0));
  await withMutation(async () => {});
  expect(await fs.readdir(dir)).toEqual([]);
});

it('includes the external owner PID and lock path in contention diagnostics', async () => {
  const other = child('hold', '');
  await other.wait((message) => message === 'entered');
  const dir = path.join(home, '.agentman', 'mutation.lock');
  // Age the actual claim, but keep it within the heartbeat lease.
  const claim = path.join(dir, (await fs.readdir(dir))[0]);
  const recent = new Date(Date.now() - 10_000);
  await fs.utimes(claim, recent, recent);
  await expect(withMutation(async () => {}, { timeoutMs: 0 })).rejects.toThrow(`PID ${other.proc.pid}; lock ${dir}`);
  expect(await fs.readFile(claim, 'utf8')).toContain(String(other.proc.pid));
});

it('renews its heartbeat while a critical section waits', async () => {
  const entered = deferred(); const release = deferred();
  const holder = withMutation(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const dir = path.join(home, '.agentman', 'mutation.lock');
  const file = path.join(dir, (await fs.readdir(dir))[0]);
  const first = (await fs.stat(file)).mtimeMs;
  try { await vi.waitFor(async () => expect((await fs.stat(file)).mtimeMs).toBeGreaterThan(first), { timeout: 6000, interval: 100 }); }
  finally { release.resolve(); await holder; }
});

it('concurrent reapers cannot remove a successor claim or enter together', async () => {
  const dir = path.join(home, '.agentman', 'mutation.lock');
  await fs.mkdir(dir, { recursive: true });
  const old = path.join(dir, 'abandoned.json');
  await fs.writeFile(old, ''); await fs.utimes(old, new Date(0), new Date(0));
  let active = 0; let maximum = 0;
  const entered = deferred(); const release = deferred(); const waiting = deferred();
  // Either acquisition may win. Both use the same barrier so the winner holds
  // its claim until the loser has demonstrably waited; no ordering assumption.
  const contend = () => withMutation(async () => {
    active++; maximum = Math.max(maximum, active); entered.resolve();
    await release.promise; active--;
  }, { onWait: waiting.resolve });
  const first = contend();
  const second = contend();
  await entered.promise;
  await waiting.promise;
  release.resolve();
  await Promise.all([first, second]);
  expect(maximum).toBe(1);
  expect(await fs.readdir(dir)).toEqual([]);
});

it('does not mistake an unrelated claim with this PID for a local queued operation', async () => {
  const directory = path.join(home, '.agentman', 'mutation.lock');
  await fs.mkdir(directory, { recursive: true });
  const claim = path.join(directory, 'unknown-claim.json');
  await fs.writeFile(claim, JSON.stringify({ pid: process.pid, token: 'unknown-claim', ticket: 1 }));
  await expect(withMutation(async () => {}, { timeoutMs: 0 })).rejects.toMatchObject({ statusCode: 409 });
  expect(await fs.readFile(claim, 'utf8')).toContain('unknown-claim');
});
