import { expect, it, vi } from 'vitest';
import { JobRegistry } from '../../../src/ui-server/jobs.js';
import { withAuthCoordinator } from '../../../src/auth/coordinator.js';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

it('queued cancellation never executes work; finished jobs are immutable and bounded', async () => {
  const jobs = new JobRegistry({ concurrent: 1, queued: 2, finished: 2 });
  const hold = barrier();
  const first = jobs.start('hold', async () => { await hold.promise; return {}; });
  await Promise.resolve();
  const run = vi.fn(async () => ({}));
  const second = jobs.start('queued', run);
  const third = jobs.start('queued', async () => ({}));
  expect(() => jobs.start('overflow', run)).toThrow('queue is full');
  await jobs.cancel(second);
  expect(run).not.toHaveBeenCalled();
  expect(jobs.get(second)).toMatchObject({ state: 'cancelled', canCancel: false });
  await expect(jobs.cancel(second)).rejects.toMatchObject({ code: 'JOB_FINISHED' });
  hold.release(); await jobs.wait(first); await jobs.wait(third);
  expect(jobs.snapshot()).toHaveLength(2);
  const fourth = jobs.start('last', async () => ({})); await jobs.wait(fourth);
  expect(() => jobs.get(second)).toThrow('Job unavailable');
  await jobs.stop();
});

it('auth cancellation waits for cleanup and never enters a mutation phase', async () => {
  const jobs = new JobRegistry();
  const entered = barrier(), cleanup = barrier();
  const mutate = vi.fn();
  const id = jobs.start('login', async (ctx) => {
    await ctx.auth(async () => {
      const aborted = new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
      entered.release();
      await aborted; await cleanup.promise;
    });
    ctx.phase('commit'); mutate(); return {};
  });
  await entered.promise;
  let cancelled = false;
  const pending = jobs.cancel(id).then(() => { cancelled = true; });
  await Promise.resolve();
  expect(cancelled).toBe(false);
  expect(jobs.get(id).state).toBe('running');
  cleanup.release(); await pending;
  expect(jobs.get(id).state).toBe('cancelled');
  expect(mutate).not.toHaveBeenCalled();
});

it('refuses cancellation during download and drains it on stop', async () => {
  const jobs = new JobRegistry();
  const entered = barrier(), release = barrier();
  const id = jobs.start('download', async (ctx) => { ctx.phase('download'); entered.release(); await release.promise; return {}; });
  await entered.promise;
  await expect(jobs.cancel(id)).rejects.toMatchObject({ code: 'JOB_NOT_CANCELLABLE' });
  let stopped = false;
  const stop = jobs.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  expect(() => jobs.start('late', async () => ({}))).toThrow('stopping');
  release.release(); await stop;
  expect(jobs.get(id).state).toBe('succeeded');
});

it('blocks unsafe authorization URLs and clears prompt URLs after completion', async () => {
  const jobs = new JobRegistry();
  const id = jobs.start('login', async (ctx) => ctx.auth(async () => { ctx.authPrompt('javascript:alert(1)'); return {}; }));
  await jobs.wait(id);
  expect(jobs.get(id)).toMatchObject({ state: 'failed', error: { name: 'ValidationError' } });
  expect(jobs.get(id).authorizeUrl).toBeUndefined();
});

it('serializes OAuth across callers and skips cancelled waiters without opening a gap', async () => {
  const hold = barrier(), entered = barrier();
  const order: number[] = [];
  const first = withAuthCoordinator(async () => { order.push(1); entered.release(); await hold.promise; order.push(2); });
  await entered.promise;
  const abort = new AbortController();
  const skipped = vi.fn();
  const second = withAuthCoordinator(async () => skipped(), abort.signal);
  const rejected = expect(second).rejects.toBeDefined();
  const third = withAuthCoordinator(async () => { order.push(3); });
  abort.abort(); await rejected;
  expect(order).toEqual([1]);
  hold.release(); await Promise.all([first, third]);
  expect(order).toEqual([1, 2, 3]); expect(skipped).not.toHaveBeenCalled();
});

it('cancels auth entered after shutdown began without opening a callback listener', async () => {
  const jobs = new JobRegistry();
  const entered = barrier(), release = barrier();
  const login = vi.fn(async () => ({}));
  const id = jobs.start('late-login', async (ctx) => {
    ctx.phase('download'); entered.release(); await release.promise;
    return ctx.auth(login);
  });
  await entered.promise;
  const stopping = jobs.stop();
  release.release(); await stopping;
  expect(jobs.get(id).state).toBe('cancelled');
  expect(login).not.toHaveBeenCalled();
});
it.each([
  ['http://localhost:8080/authorize', true], ['http://127.0.0.1:8080/authorize', true],
  ['http://[::1]:8080/authorize', true], ['http://auth.example.com/authorize', false],
  ['http://localhost.example.com/authorize', false], ['http://user:pass@localhost/authorize', false],
])('authorization URL policy: %s', async (url, allowed) => {
  const jobs = new JobRegistry();
  let shown: string | undefined;
  const id = jobs.start('auth', async (ctx) => ctx.auth(async () => { ctx.authPrompt(url); shown = url; return {}; }));
  await jobs.wait(id);
  expect(jobs.get(id).state).toBe(allowed ? 'succeeded' : 'failed');
  expect(shown).toBe(allowed ? url : undefined);
});
it('retains the most recently completed job even when it started first', async () => {
  const jobs = new JobRegistry({ concurrent: 2, queued: 2, finished: 1 });
  const hold = barrier();
  const slow = jobs.start('slow', async () => { await hold.promise; return {}; });
  const fast = jobs.start('fast', async () => ({}));
  await jobs.wait(fast); hold.release(); await jobs.wait(slow);
  expect(jobs.get(slow).state).toBe('succeeded');
  expect(() => jobs.get(fast)).toThrow('Job unavailable');
});
