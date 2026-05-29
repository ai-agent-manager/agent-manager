import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

  const targetDir = getBundleVersionDir(manifest.version);

  // Check if already cached
  if (await dirExists(targetDir)) {
    return { manifest, bundleDir: targetDir, isNew: false, warning };
  }

  // Copy directory contents into cache
  await mkdir(targetDir, { recursive: true });
  try {
    await cp(dirPath, targetDir, { recursive: true });

    // If we generated the manifest, write it into the cached copy
    if (generatedManifest) {
      await writeFile(
        path.join(targetDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
    }

    return { manifest, bundleDir: targetDir, isNew: true, warning };
  } catch (error) {
    // Clean up on failure
    await rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
