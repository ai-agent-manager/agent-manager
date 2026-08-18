import { mkdir, readFile, rm, rename } from 'node:fs/promises';
import extractZip from 'extract-zip';
import path from 'node:path';
import { getBundlesDir, getBundleVersionDir, getTempDir } from '../config/paths.js';
import { parseManifest, type BundleManifest } from './manifest.js';

export interface ExtractResult {
  manifest: BundleManifest;
  bundleDir: string;
  isNew: boolean;
}

export interface ExtractBundleOptions {
  /**
   * Stable HTTP source key for source-scoped caches. Omit to preserve
   * the legacy global cache keyed only by manifest version.
   */
  sourceKey?: string;
}

function assertSafeCacheSegment(value: string, label: string): void {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be a safe single path segment: ${value}`);
  }
}

/**
 * Extract an agents.zip file, read its manifest, and cache it
 * under ~/.agentman/bundles/<version>/.
 * Returns early if this version is already cached.
 */
export async function extractBundle(zipPath: string, options: ExtractBundleOptions = {}): Promise<ExtractResult> {
  // First, extract to a temp dir to read the manifest
  const tempExtractDir = `${getTempDir()}/extract-${Date.now()}`;
  await mkdir(tempExtractDir, { recursive: true });

  try {
    await extractZip(zipPath, { dir: tempExtractDir });

    // Read manifest
    const manifestRaw = await readFile(`${tempExtractDir}/manifest.json`, 'utf-8');
    const manifest = parseManifest(manifestRaw);
    assertSafeCacheSegment(manifest.version, 'Bundle manifest version');
    if (options.sourceKey) {
      assertSafeCacheSegment(options.sourceKey, 'Bundle source key');
    }

    // Check if this version is already cached
    const targetDir = options.sourceKey
      ? path.join(getBundlesDir(), 'sources', options.sourceKey, manifest.version)
      : getBundleVersionDir(manifest.version);
    const alreadyCached = await dirExists(targetDir);

    if (alreadyCached) {
      // Clean up temp extraction
      await rm(tempExtractDir, { recursive: true, force: true });
      return { manifest, bundleDir: targetDir, isNew: false };
    }

    // Move to the permanent cache location
    await mkdir(targetDir, { recursive: true });
    // Use rename-like approach: extract directly to target
    await rm(targetDir, { recursive: true, force: true });
    await rename(tempExtractDir, targetDir);

    return { manifest, bundleDir: targetDir, isNew: true };
  } catch (error) {
    // Clean up on failure
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}
