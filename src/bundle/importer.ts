import { writeFileAtomic } from '../lib/fs.js';
import { adoptBundle, verifyBundleContent } from './adoption.js';
import { randomUUID } from 'node:crypto';
import { OperationConflictError } from '../lib/mutation.js';
import { assertBundleVersion, assertCacheDestination, readBundleIdentity } from './version-identity.js';
import { withMutation } from '../lib/mutation.js';
import { cp, mkdir, readFile, rm, stat, writeFile, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { getBundleVersionDir } from '../config/paths.js';
import { parseManifest, type BundleManifest } from './manifest.js';

export interface ImportResult {
  manifest: BundleManifest;
  bundleDir: string;
  isNew: boolean;
  /** Set when no manifest.json was found and a dev version was generated. */
  warning?: string;
}

/**
 * Generate a dev version string in the format `dev-YYYYMMDDhhmm`.
 */
export function generateDevVersion(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `dev-${y}${mo}${d}${h}${mi}`;
}

/**
 * Import a local directory as a bundle into the cache.
 *
 * - If the directory contains manifest.json, its version/published are used as-is.
 * - If manifest.json is missing, a dev version (dev-YYYYMMDDhhmm) is generated
 *   and a warning is returned.
 *
 * The directory contents are copied into ~/.agentman/bundles/<version>/.
 * Returns early (isNew: false) if that version is already cached.
 */
export async function importLocalBundle(dirPath: string): Promise<ImportResult> {
  return withMutation(async () => {
    let manifest: BundleManifest;
    let warning: string | undefined;
    let generatedManifest = false;

    const manifestPath = path.join(dirPath, 'manifest.json');
    try {
      const raw = await readFile(manifestPath, 'utf-8');
      manifest = parseManifest(raw);
    } catch {
      // No manifest found — generate a dev version
      const version = generateDevVersion();
      const published = new Date().toISOString();
      manifest = { version, published };
      warning =
        'No manifest.json found in bundle directory. ' +
        `Using generated dev version: ${version}. ` +
        'This is not suitable for production use.';
      generatedManifest = true;
    }

    assertBundleVersion(manifest.version);
    const targetDir = getBundleVersionDir(manifest.version);
    await assertCacheDestination(targetDir);
    const directory = await realpath(dirPath);

    // Copy directory contents into cache
    const staged = `${targetDir}.stage-${randomUUID()}`;
    await mkdir(staged, { recursive: true });
    try {
      await cp(dirPath, staged, { recursive: true });

      // If we generated the manifest, write it into the cached copy
      if (generatedManifest) {
        await writeFile(
          path.join(staged, 'manifest.json'),
          JSON.stringify(manifest, null, 2)
        );
      }

      if (await dirExists(targetDir)) {
        let marker;
        try { marker = JSON.parse(await readFile(path.join(targetDir, '.source.json'), 'utf8')); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new OperationConflictError('Cached directory provenance is unreadable.');
        }
        if (!marker) {
          const cachedManifest = parseManifest(await readFile(path.join(targetDir, 'manifest.json'), 'utf8'));
          if (cachedManifest.version !== manifest.version) throw new OperationConflictError('Cached manifest does not match the selected version.');
          await adoptBundle(targetDir, staged, { directory }, generatedManifest);
        } else {
          const identity = await readBundleIdentity(targetDir);
          if (!identity.directory) throw new OperationConflictError(`Cached version ${manifest.version} belongs to a URL source. Use a distinct version or remove the unused cache before importing.`);
          if (identity.directory !== directory && !identity.directoryAliases?.includes(directory)) {
            await verifyBundleContent(targetDir, staged, generatedManifest);
            // Keep original pins valid; only locally verified copies can add aliases.
            await writeFileAtomic(path.join(targetDir, '.source.json'), JSON.stringify({
              ...marker, directoryAliases: [...identity.directoryAliases ?? [], directory],
            }));
          }
        }
        return { manifest, bundleDir: targetDir, isNew: false, warning };
      }

      // A copied source marker is never evidence of origin.
      await rm(path.join(staged, '.source.json'), { recursive: true, force: true });
      await writeFile(path.join(staged, '.source.json'), JSON.stringify({ directory, trackedReferences: true }));
      await rename(staged, targetDir);
      return { manifest, bundleDir: targetDir, isNew: true, warning };
    } finally {
      await rm(staged, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
