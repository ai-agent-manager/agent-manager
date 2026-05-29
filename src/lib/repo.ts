import path from 'node:path';
import { stat } from 'node:fs/promises';

/**
 * Walk up from `startDir` looking for a `.git` directory.
 * Returns the repo root (the directory containing `.git`) or `null`
 * if no git repository is found.
 */
export async function findRepoRoot(startDir?: string): Promise<string | null> {
  let dir = path.resolve(startDir ?? process.cwd());

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const gitDir = path.join(dir, '.git');
    try {
      const s = await stat(gitDir);
      if (s.isDirectory() || s.isFile()) return dir;
    } catch {
      // .git not found here — keep walking up
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      return null;
    }
    dir = parent;
  }
}

/**
 * Convenience wrapper — returns `true` when `startDir` (or cwd) is inside
 * a git repository.
 */
export async function isInsideRepo(startDir?: string): Promise<boolean> {
  return (await findRepoRoot(startDir)) !== null;
}

/**
 * Get the short name of the repo (the last path segment of the root).
 * Returns `null` if not inside a repo.
 */
export async function getRepoName(startDir?: string): Promise<string | null> {
  const root = await findRepoRoot(startDir);
  return root ? path.basename(root) : null;
}
