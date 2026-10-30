import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { createLink, type LinkResult } from './symlink.js';

/** Caller holds the mutation lock across link publication and record commit. */
export async function installLinkTransaction(target: string, destination: string, commit: (link: LinkResult) => Promise<void>): Promise<LinkResult> {
  const staged = `${destination}.stage-${randomUUID()}`;
  const backup = `${destination}.backup-${randomUUID()}`;
  let backedUp = false;
  let published = false;
  let result: LinkResult;
  try {
    const created = await createLink(target, staged);
    result = { ...created, link: destination };
    try { await rename(destination, backup); backedUp = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(staged, destination);
    published = true;
    await commit(result);
  } catch (error) {
    if (published) await rm(destination, { recursive: true, force: true });
    if (backedUp) await rename(backup, destination);
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  await rm(backup, { recursive: true, force: true });
  return result;
}
