import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, rename, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { getBundleVersionDir, getTempDir } from '../config/paths.js';
import { parseManifest, type BundleManifest } from './manifest.js';

/** Metadata persisted alongside a cached bundle for content-hash invalidation. */
export const BUNDLE_META_FILE = '.bundle.json';

export interface BundleCacheMeta {
  version: string;
  sha256: string;
  extractedAt: string;
}

export interface ExtractResult {
  manifest: BundleManifest;
  bundleDir: string;
  isNew: boolean;
}

export interface ExtractBundleOptions {
  /** Force re-extraction even when a matching content hash is already cached. */
  forceUpdate?: boolean;
}

/**
 * Extract an agents.zip file, read its manifest, and cache it
 * under ~/.agentman/bundles/<version>/.
 *
 * Cache hits are keyed by both manifest version **and** the ZIP's SHA-256.
 * That way republishing the same version with different contents (common for
 * local mocks that stay on `0.1.0`) still refreshes the cache. Legacy cache
 * directories without `.bundle.json` are treated as a miss and re-extracted.
 */
export async function extractBundle(
  zipPath: string,
  options: ExtractBundleOptions = {},
): Promise<ExtractResult> {
  const zipSha256 = await hashFile(zipPath);

  // Peek at the manifest version without committing to a full extract yet.
  // We still need a temp extract to read manifest.json from the zip.
  const tempExtractDir = path.join(getTempDir(), `extract-${Date.now()}`);
  await mkdir(tempExtractDir, { recursive: true });

  try {
    await extractZip(zipPath, { dir: tempExtractDir });

    const manifestRaw = await readFile(path.join(tempExtractDir, 'manifest.json'), 'utf-8');
    const manifest = parseManifest(manifestRaw);
    const targetDir = getBundleVersionDir(manifest.version);

    if (!options.forceUpdate && (await dirExists(targetDir))) {
      const cached = await readBundleMeta(targetDir);
      if (cached?.sha256 === zipSha256) {
        await rm(tempExtractDir, { recursive: true, force: true });
        return { manifest, bundleDir: targetDir, isNew: false };
      }
    }

    await writeFile(
      path.join(tempExtractDir, BUNDLE_META_FILE),
      JSON.stringify(
        {
          version: manifest.version,
          sha256: zipSha256,
          extractedAt: new Date().toISOString(),
        } satisfies BundleCacheMeta,
        null,
        2,
      ),
    );

    // Replace any stale cache for this version.
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(path.dirname(targetDir), { recursive: true });
    await rename(tempExtractDir, targetDir);

    return { manifest, bundleDir: targetDir, isNew: true };
  } catch (error) {
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function readBundleMeta(cacheDir: string): Promise<BundleCacheMeta | null> {
  try {
    const raw = await readFile(path.join(cacheDir, BUNDLE_META_FILE), 'utf-8');
    const meta = JSON.parse(raw) as BundleCacheMeta;
    if (!meta.sha256 || typeof meta.sha256 !== 'string') return null;
    return meta;
  } catch {
    return null;
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
