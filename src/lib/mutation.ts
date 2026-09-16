import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat, unlink, utimes } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { getAgentmanDir } from '../config/paths.js';

export class OperationConflictError extends Error {
  readonly code = 'OPERATION_CONFLICT';
  readonly statusCode = 409;
  constructor(message: string) { super(message); this.name = 'OperationConflictError'; }
}

export const MUTATION_HEARTBEAT_MS = 2_000;
export const MUTATION_STALE_MS = 60_000;
interface Owner { pid: number; token: string; ticket: number }
interface Lease { path: string; active: boolean; lastBeat: number; lost: boolean }
const context = new AsyncLocalStorage<Lease>();
const owned = new Set<Lease>();

/** Each acquisition owns a unique file, never a shared pathname that a late
 * reaper could unlink after a successor acquires it. Files implement a bakery
 * queue: publish "choosing" (ticket 0), choose max+1, then wait for earlier
 * tickets and all visible choosing processes. Later arrivals choose larger
 * tickets. Dead owners are reaped immediately; heartbeat expiry covers PID reuse
 * and inaccessible owners. A lease that misses its renewal must not resume work.
 * Lock order remains mutation -> config. Await every nested mutation.
 */
export async function withMutation<T>(run: () => Promise<T>, options: {
  timeoutMs?: number; onWait?: () => void;
  /** Bound all queue waits (including this process); never interrupt a commit. */
  waitTimeoutMs?: number; signal?: AbortSignal;
} = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const started = Date.now();
  const lockDir = path.join(getAgentmanDir(), 'mutation.lock');
  const parent = context.getStore();
  if (parent?.active && path.dirname(parent.path) === lockDir) {
    await assertLease(parent);
    return run();
  }
  await mkdir(path.dirname(lockDir), { recursive: true });
  await prepareDirectory(lockDir);
  const token = `${process.pid}-${randomUUID()}`;
  const file = path.join(lockDir, `${token}.json`);
  const lease: Lease = { path: file, active: true, lastBeat: Date.now(), lost: false };
  const owner: Owner = { pid: process.pid, token, ticket: 0 };
  // Publish choosing before observing peers. Partial writes are also choosing.
  const handle = await open(file, 'wx', 0o600);
  owned.add(lease);
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || !lease.active) return;
    if (Date.now() - lease.lastBeat >= MUTATION_STALE_MS) { lease.lost = true; return; }
    renewing = true;
    const now = new Date();
    void utimes(file, now, now).then(() => { lease.lastBeat = Date.now(); }, () => { lease.lost = true; })
      .finally(() => { renewing = false; });
  }, MUTATION_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    await handle.writeFile(JSON.stringify(owner));
    const peers = await readOwners(lockDir);
    owner.ticket = Math.max(0, ...peers.map((peer) => peer.owner?.ticket ?? 0)) + 1;
    // Rewrite through this acquisition's descriptor; readers treat partial JSON
    // as choosing, so nobody can enter based on an incomplete ticket.
    await handle.truncate(0);
    await handle.write(JSON.stringify(owner), 0, 'utf8');
    let externalWaitMs = 0;
    let lastCheck = Date.now();
    for (;;) {
      options.signal?.throwIfAborted();
      if (options.waitTimeoutMs !== undefined && Date.now() - started >= options.waitTimeoutMs) {
        throw new OperationConflictError('Another operation is still running. Retry when it finishes.');
      }
      await assertLease(lease);
      const blocker = (await readOwners(lockDir)).find((peer) => peer.file !== file && (
        !peer.owner?.ticket || peer.owner.ticket < owner.ticket ||
        (peer.owner.ticket === owner.ticket && peer.owner.token < owner.token)
      ));
      if (!blocker) break;
      options.onWait?.();
      const now = Date.now();
      // In-process jobs form a queue, not contention with another application.
      // Only external owners consume the contention timeout.
      const localOwner = [...owned].some((item) => item.active && item.path === blocker.file);
      if (!localOwner) externalWaitMs += now - lastCheck;
      lastCheck = now;
      if (!localOwner && externalWaitMs >= (options.timeoutMs ?? 30_000)) {
        throw new OperationConflictError(`Another agentman operation is running (PID ${blocker.owner?.pid ?? 'unknown'}; lock ${lockDir}). Retry when it finishes.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    options.signal?.throwIfAborted();
    const result = await context.run(lease, run);
    await assertLease(lease);
    return result;
  } finally {
    lease.active = false;
    clearInterval(heartbeat);
    await handle.close();
    await unlink(file).catch(() => {});
    owned.delete(lease);
  }
}

async function assertLease(lease: Lease): Promise<void> {
  if (lease.lost || Date.now() - lease.lastBeat >= MUTATION_STALE_MS || !await stat(lease.path).catch(() => null)) {
    lease.lost = true;
    throw new OperationConflictError('Operation ownership expired. Reload and retry the operation.');
  }
}

async function readOwners(directory: string) {
  const peers: { file: string; owner?: Owner }[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    let owner: Owner | undefined;
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as Owner;
      if (Number.isSafeInteger(value.pid) && value.pid > 0 && Number.isSafeInteger(value.ticket) && value.ticket >= 0 && `${value.token}.json` === name) owner = value;
    } catch { /* An incomplete write is a choosing participant until it expires. */ }
    let dead = false;
    if (owner) {
      try { process.kill(owner.pid, 0); }
      catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }
    if (dead || Date.now() - info.mtimeMs >= MUTATION_STALE_MS) {
      // Only this acquisition's UUID path is removed. It can never be the
      // pathname of a successor, including when multiple reapers race.
      await unlink(file).catch(() => {});
      continue;
    }
    peers.push({ file, owner });
  }
  return peers;
}

/** Upgrade the earlier experimental single-file lock, without ever unlinking
 * the directory used by new owners. unlink(directory) fails on every platform.
 */
async function prepareDirectory(directory: string): Promise<void> {
  try { await mkdir(directory); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const info = await stat(directory);
  if (info.isDirectory()) return;
  let dead = false;
  let pid: number | undefined;
  try { pid = JSON.parse(await readFile(directory, 'utf8')).pid; if (pid && pid > 0) process.kill(pid, 0); }
  catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  if (!dead && Date.now() - info.mtimeMs < MUTATION_STALE_MS) throw new OperationConflictError(`Another agentman operation owns the legacy lock ${directory} (PID ${pid ?? 'unknown'}). Retry shortly.`);
  await unlink(directory).catch((error) => {
    if (!['ENOENT', 'EISDIR', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  });
  await mkdir(directory, { recursive: true });
}

/** Synchronous cleanup is safe even from a signal/exit handler: filenames are
 * acquisition-specific and are never reused by a different owner. */
export function releaseOwnedLocks(): void {
  for (const lease of owned) {
    lease.active = false;
    lease.lost = true;
    try { unlinkSync(lease.path); } catch { /* Already removed. */ }
  }
  owned.clear();
}

export function installMutationSignalHandlers(): () => void {
  const onInt = () => { releaseOwnedLocks(); process.removeListener('SIGINT', onInt); process.kill(process.pid, 'SIGINT'); };
  const onTerm = () => { releaseOwnedLocks(); process.removeListener('SIGTERM', onTerm); process.kill(process.pid, 'SIGTERM'); };
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('exit', releaseOwnedLocks);
  return () => { process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); process.removeListener('exit', releaseOwnedLocks); };
}
