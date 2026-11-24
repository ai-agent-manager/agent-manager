import { cp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { getBackupsDir } from '../config/paths.js';
import { ensureDir } from './fs.js';

/**
 * Move `sourcePath` into ~/.agentman/backups/<group>/ under a timestamped name
 * and return the new location. Backups live outside the tool's skills dir so
 * the tool never loads them.
 */
export async function backupPath(sourcePath: string, group: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.join(getBackupsDir(), group);
  const target = path.join(targetDir, `${path.basename(sourcePath)}-${stamp}`);
  await ensureDir(targetDir);

  try {
    await rename(sourcePath, target);
  } catch (error) {
    // Repo-scoped skills may sit on a different filesystem from the home dir.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(sourcePath, target, { recursive: true, verbatimSymlinks: true });
    await rm(sourcePath, { recursive: true, force: true });
  }

  return target;
}
