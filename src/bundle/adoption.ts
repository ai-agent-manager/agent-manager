import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '../lib/fs.js';
import { OperationConflictError } from '../lib/mutation.js';

/** Compare the downloaded/imported content with a legacy cache before vouching
 * for its origin. A matching version label alone is never proof of provenance.
 * Cache-owned root metadata is excluded; archive-supplied markers are ignored.
 */
async function digest(directory: string, ignoreManifest: boolean): Promise<string> {
  const hash = createHash('sha256');
  async function walk(relative: string) {
    const entries = await readdir(path.join(directory, relative));
    for (const name of entries.sort()) {
      if (!relative && (name === '.source.json' || (ignoreManifest && name === 'manifest.json'))) continue;
      const child = path.join(relative, name);
      const full = path.join(directory, child);
      const info = await lstat(full);
      hash.update(JSON.stringify([child, info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'dir' : 'file']));
      if (info.isSymbolicLink()) hash.update(await readlink(full));
      else if (info.isDirectory()) await walk(child);
      else hash.update(await readFile(full));
    }
  }
  await walk('');
  return hash.digest('hex');
}

export async function verifyBundleContent(directory: string, staged: string, ignoreManifest = false): Promise<void> {
  if (await digest(directory, ignoreManifest) !== await digest(staged, ignoreManifest)) {
    throw new OperationConflictError(`Cached version ${path.basename(directory)} differs from the selected source. Use a distinct version or remove the unused cached version before importing again.`);
  }
}

export async function adoptBundle(directory: string, staged: string, origin: { contentRoot: string } | { directory: string }, ignoreManifest = false): Promise<void> {
  await verifyBundleContent(directory, staged, ignoreManifest);
  await writeFileAtomic(path.join(directory, '.source.json'), JSON.stringify({ ...origin, trackedReferences: false }));
}
