import { symlink, unlink, stat, cp, readlink, rm } from 'node:fs/promises';
import { getPlatform } from './platform.js';

export type LinkMethod = 'symlink' | 'copy';

export interface LinkResult {
  method: LinkMethod;
  target: string;
  link: string;
}

/**
 * Create a symlink from `linkPath` to `targetPath`.
 * On Windows, falls back to copying if symlink creation fails.
 * If the link/directory already exists, it is replaced.
 */
export async function createLink(targetPath: string, linkPath: string): Promise<LinkResult> {
  // Remove existing link or directory
  try {
    const s = await stat(linkPath);
    if (s.isDirectory()) {
      await rm(linkPath, { recursive: true, force: true });
    } else {
      await unlink(linkPath);
    }
  } catch {
    // Doesn't exist, which is fine
  }

  // Also handle dangling symlinks
  try {
    await readlink(linkPath);
    await unlink(linkPath);
  } catch {
    // Not a symlink or doesn't exist
  }

  // Try symlink first
  try {
    const symlinkType = getPlatform() === 'windows' ? 'junction' : 'dir';
    await symlink(targetPath, linkPath, symlinkType);
    return { method: 'symlink', target: targetPath, link: linkPath };
  } catch (error) {
    // On Windows, symlinks may fail without admin/dev mode
    if (getPlatform() === 'windows') {
      await cp(targetPath, linkPath, { recursive: true });
      return { method: 'copy', target: targetPath, link: linkPath };
    }
    throw error;
  }
}

/**
 * Remove a symlink or copied directory.
 */
export async function removeLink(linkPath: string): Promise<void> {
  try {
    const linkStat = await stat(linkPath);
    if (linkStat.isDirectory()) {
      // Could be a copy — remove recursively
      await rm(linkPath, { recursive: true, force: true });
    } else {
      await unlink(linkPath);
    }
  } catch {
    // Already removed or doesn't exist
  }

  // Handle dangling symlink
  try {
    await readlink(linkPath);
    await unlink(linkPath);
  } catch {
    // Not a symlink
  }
}

/**
 * Resolve a symlink to determine what bundle version it points to.
 * Returns the version hash if the link points into ~/.agentman/bundles/<hash>/,
 * or null if it doesn't resolve or isn't in the expected location.
 */
export async function resolveSkillVersion(linkPath: string): Promise<string | null> {
  try {
    const target = await readlink(linkPath);
    // Expected: /home/user/.agentman/bundles/<hash>/<skill-name>
    const match = target.match(/\.agentman[/\\]bundles[/\\]([^/\\]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
