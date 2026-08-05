import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, utimes, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withLock } from '../../../src/lib/file-lock.js';

let tempDir: string;
let lockPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-file-lock-test-'));
  lockPath = path.join(tempDir, 'test.lock');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('withLock', () => {
  it('runs the callback and removes the lock file afterwards', async () => {
    const result = await withLock(lockPath, async () => 'done');
    expect(result).toBe('done');

    const exists = await stat(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('removes the lock file even when the callback throws', async () => {
    await expect(
      withLock(lockPath, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const exists = await stat(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it('serializes two concurrent holders so their critical sections never overlap', async () => {
    const events: string[] = [];

    const first = withLock(lockPath, async () => {
      events.push('first-start');
      await sleep(30);
      events.push('first-end');
    });

    // Give the first call a head start so it acquires the lock first.
    await sleep(5);

    const second = withLock(lockPath, async () => {
      events.push('second-start');
      await sleep(5);
      events.push('second-end');
    });

    await Promise.all([first, second]);

    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('breaks a stale lock left by a crashed process instead of hanging', async () => {
    await writeFile(lockPath, '999999');
    // Backdate the lock file well past the staleness threshold.
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    const result = await withLock(lockPath, async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
