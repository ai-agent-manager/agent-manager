import { bundleDirectoryForPin } from './version-identity.js';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { getAgentmanDir, getConfigPath } from '../config/paths.js';
import { writeFileAtomic } from '../lib/fs.js';
import { OperationConflictError, withMutation } from '../lib/mutation.js';
import type { InstallRecord } from './cache.js';

const registryPath = () => path.join(getAgentmanDir(), 'repositories.json');

async function repositories(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(registryPath(), 'utf8'));
    if (!Array.isArray(value) || !value.every((root) => typeof root === 'string' && path.isAbsolute(root))) throw new Error('Invalid repository registry');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new OperationConflictError('Cannot verify repository cache references.');
  }
}

/**
 * Registered before repo publication; stale entries are deliberately retained.
 * The lease is taken only when the registry is actually missing the entry, so
 * read paths can adopt repositories without serialising on every inventory read.
 */
export async function registerRepository(repoRoot: string): Promise<void> {
  const root = await realpath(repoRoot);
  if ((await repositories()).includes(root)) return;
  return withMutation(async () => {
    const roots = await repositories();
    if (!roots.includes(root)) await writeFileAtomic(registryPath(), JSON.stringify([...roots, root]));
  });
}

/**
 * Adopt a repository whose `.agentman.json` predates the registry (written by a
 * release without reference tracking), so cache deletion can see its installs.
 * Runs on the read path, so it never throws: a corrupt registry already makes
 * assertBundleUnreferenced fail closed, and an unwritable one must not break reads.
 */
export async function adoptRepository(repoRoot: string): Promise<void> {
  try { await registerRepository(repoRoot); } catch { /* Deletion still fails closed via assertBundleUnreferenced. */ }
}

/** Fail closed on unreadable/corrupt records; never invoke forgiving config migration. */
export async function assertBundleUnreferenced(version: string, bundleDir?: string): Promise<void> {
  const files = [getConfigPath(), ...(await repositories()).map((root) => path.join(root, '.agentman.json'))];
  for (const file of files) {
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new OperationConflictError('Cannot verify all installed bundle references.');
    }
    let installations: Record<string, Record<string, InstallRecord>>;
    try {
      installations = JSON.parse(raw).installations;
      if (!installations || typeof installations !== 'object') throw new Error('Invalid installations');
      for (const records of Object.values(installations)) {
        for (const record of Object.values(records)) {
          if ((record.sourcePin?.bundleVersion ?? record.bundleVersion) === version) {
            if (bundleDir && record.sourcePin?.sourceType === 'bundle' && bundleDirectoryForPin(record.sourcePin, version) !== bundleDir) continue;
            if (record.sourcePin && record.sourcePin.sourceType !== 'bundle') continue;
            throw new OperationConflictError(`Bundle ${version} is referenced by an installed skill. Remove or switch the installation first.`);
          }
        }
      }
    } catch (error) {
      if (error instanceof OperationConflictError) throw error;
      throw new OperationConflictError('Cannot verify all installed bundle references.');
    }
  }
}
