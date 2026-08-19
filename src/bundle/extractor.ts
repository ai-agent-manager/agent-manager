import { mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
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
  /**
   * Content root this bundle came from. Recorded beside the cache entry so a
   * second publisher using the same source name cannot be served the first
   * one's bundle — see assertSameContentRoot.
   */
  contentRoot?: string;
}

/** Directory the source-scoped cache tree occupies inside the bundles dir. */
const SOURCES_SUBTREE = 'sources';

/** Provenance file written beside a source's cached versions. */
const SOURCE_MARKER = 'source.json';

export function assertSafeCacheSegment(value: string, label: string): void {
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
    } else if (manifest.version === SOURCES_SUBTREE) {
      // The legacy cache is keyed by version directly under the bundles dir, so
      // a version literally named after the source-scoped subtree would resolve
      // to its root and plant a bundle over it.
      throw new Error(`Bundle manifest version must not be '${SOURCES_SUBTREE}'`);
    }

    // Check if this version is already cached
    const sourceDir = options.sourceKey
      ? path.join(getBundlesDir(), SOURCES_SUBTREE, options.sourceKey)
      : undefined;
    const targetDir = sourceDir
      ? path.join(sourceDir, manifest.version)
      : getBundleVersionDir(manifest.version);

    if (sourceDir && options.contentRoot) {
      await assertSameContentRoot(sourceDir, options.sourceKey!, options.contentRoot);
    }

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

    if (sourceDir && options.contentRoot) {
      await writeFile(
        path.join(sourceDir, SOURCE_MARKER),
        `${JSON.stringify({ contentRoot: options.contentRoot }, null, 2)}\n`,
        'utf-8',
      );
    }

    return { manifest, bundleDir: targetDir, isNew: true };
  } catch (error) {
    // Clean up on failure
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Refuse to reuse a source's cache for a different content root.
 *
 * Source names are only required to be unique within one discovery document, so
 * two documents can each declare a source called e.g. `official`. Both would map
 * to the same cache directory, and the already-cached short-circuit would serve
 * the first publisher's bundle under the second's pin. Failing loudly is the
 * containment measure; making the identity model handle several publishers is
 * the wider question tracked with the source-scoped cache work.
 */
async function assertSameContentRoot(
  sourceDir: string,
  sourceKey: string,
  contentRoot: string,
): Promise<void> {
  let recorded: string | undefined;
  try {
    const raw = await readFile(path.join(sourceDir, SOURCE_MARKER), 'utf-8');
    recorded = (JSON.parse(raw) as { contentRoot?: string }).contentRoot;
  } catch {
    // No marker yet (or unreadable): nothing to contradict.
    return;
  }

  if (recorded && recorded !== contentRoot) {
    throw new Error(
      `Source '${sourceKey}' is already cached from a different content root. ` +
        `Cached: ${recorded}. Requested: ${contentRoot}. ` +
        `Two discovery documents are using one source name for different publishers; ` +
        `rename one of them.`,
    );
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
