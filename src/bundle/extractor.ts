import { mkdir, readFile, rm, rename } from 'node:fs/promises';
import extractZip from 'extract-zip';
import { getBundleVersionDir, getTempDir } from '../config/paths.js';
import { parseManifest, type BundleManifest } from './manifest.js';

export interface ExtractResult {
  manifest: BundleManifest;
  bundleDir: string;
  isNew: boolean;
}

/**
 * Extract an agents.zip file, read its manifest, and cache it
 * under ~/.agentman/bundles/<version>/.
 * Returns early if this version is already cached.
 */
export async function extractBundle(zipPath: string): Promise<ExtractResult> {
  // First, extract to a temp dir to read the manifest
  const tempExtractDir = `${getTempDir()}/extract-${Date.now()}`;
  await mkdir(tempExtractDir, { recursive: true });

  try {
    await extractZip(zipPath, { dir: tempExtractDir });

    // Read manifest
    const manifestRaw = await readFile(`${tempExtractDir}/manifest.json`, 'utf-8');
    const manifest = parseManifest(manifestRaw);

    // Check if this version is already cached
    const targetDir = getBundleVersionDir(manifest.version);
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
