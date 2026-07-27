import { open, rm, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ACQUIRE_TIMEOUT_MS = 5000;
const RETRY_INTERVAL_MS = 50;
const STALE_LOCK_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs > STALE_LOCK_MS;
  } catch {
    // Lock disappeared between our EEXIST and this check — not stale, just gone.
    return false;
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  // The lock file's directory may not exist yet on a genuinely first run
  // (e.g. before ~/.agentman has ever been created) — without this, open()
  // fails with ENOENT rather than the EEXIST this loop knows how to retry.
  await mkdir(path.dirname(lockPath), { recursive: true });

  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      if (await isStale(lockPath)) {
        await rm(lockPath, { force: true }).catch(() => {});
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for lock at ${lockPath}`);
      }

      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Runs `fn` while holding an exclusive file lock at `lockPath`, so that
 * concurrent agentman processes serialize their read-modify-write cycles
 * instead of clobbering each other. Uses O_EXCL (open with 'wx') rather than
 * a locking library — a lock held past STALE_LOCK_MS is assumed abandoned
 * (e.g. a crashed process) and is broken automatically.
 */
export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}
