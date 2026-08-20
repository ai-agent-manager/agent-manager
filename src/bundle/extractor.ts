import { mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises';
import extractZip from 'extract-zip';
import path from 'node:path';
import { getBundlesDir, getBundleVersionDir, getTempDir } from '../config/paths.js';
import { assertSafeCacheSegment } from '../lib/path-segment.js';
import { canonicaliseContentRoot } from './downloader.js';
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
   * one's bundle — see readSourceMarker.
   */
  contentRoot?: string;
}

/** Directory the source-scoped cache tree occupies inside the bundles dir. */
const SOURCES_SUBTREE = 'sources';

/** Provenance file written beside a source's cached versions. */
const SOURCE_MARKER = 'source.json';

export { assertSafeCacheSegment };

/**
 * Extract an agents.zip file, read its manifest, and cache it under
 * ~/.agentman/bundles/<version>/, or ~/.agentman/bundles/sources/<key>/<version>/
 * when the bundle belongs to a declared source.
 * Returns early if this version is already cached with matching provenance.
 */
export async function extractBundle(zipPath: string, options: ExtractBundleOptions = {}): Promise<ExtractResult> {
  // Canonicalise here rather than trusting callers: the resolver has a URL
  // straight from a discovery document while the update path has one that
  // already went through a pin, and comparing those two forms as written makes
  // a single publisher trip its own collision alarm.
  const contentRoot = options.contentRoot ? canonicaliseContentRoot(options.contentRoot) : undefined;

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
      // Versions live directly under the source directory, so one named after
      // the provenance marker would be extracted over it — silencing the guard
      // for that source from then on. Manifest versions are only required to be
      // a safe segment at runtime, so this is reachable input, not just theory.
      if (manifest.version === SOURCE_MARKER) {
        throw new Error(`Bundle manifest version must not be '${SOURCE_MARKER}'`);
      }
    } else if (manifest.version === SOURCES_SUBTREE) {
      // The legacy cache is keyed by version directly under the bundles dir, so
      // a version literally named after the source-scoped subtree would resolve
      // to its root and plant a bundle over it.
      throw new Error(`Bundle manifest version must not be '${SOURCES_SUBTREE}'`);
    }

    const sourceDir = options.sourceKey
      ? path.join(getBundlesDir(), SOURCES_SUBTREE, options.sourceKey)
      : undefined;
    const targetDir = sourceDir
      ? path.join(sourceDir, manifest.version)
      : getBundleVersionDir(manifest.version);

    // Provenance is only meaningful for source-scoped caches; the legacy cache
    // is keyed by version alone and has no source to attribute.
    let provenanceMatches = true;
    if (sourceDir && contentRoot) {
      const marker = await readSourceMarker(sourceDir);

      if (marker.kind === 'present' && marker.contentRoot !== contentRoot) {
        throw new Error(
          `Source '${options.sourceKey}' is already cached from a different content root. ` +
            `Cached: ${marker.contentRoot}. Requested: ${contentRoot}. ` +
            `Two discovery documents are using one source name for different publishers; ` +
            `rename one of them, or remove ${sourceDir} to start over.`,
        );
      }

      // Absent or unreadable means the cache carries no provenance we can
      // attest, so it is not reused: re-extracting records fresh provenance,
      // where backfilling a marker would vouch for contents of unknown origin.
      provenanceMatches = marker.kind === 'present';
    }

    if (provenanceMatches && (await dirExists(targetDir))) {
      // Clean up temp extraction
      await rm(tempExtractDir, { recursive: true, force: true });
      return { manifest, bundleDir: targetDir, isNew: false };
    }

    // Record provenance before the version directory is visible, so a crash
    // between the two can never leave an unattributed cache behind.
    if (sourceDir && contentRoot) {
      await writeSourceMarker(sourceDir, contentRoot);
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

type SourceMarker = { kind: 'present'; contentRoot: string } | { kind: 'absent' } | { kind: 'unreadable' };

/**
 * Read a source's provenance marker.
 *
 * Only a missing file counts as "no marker". Every other failure — a directory
 * in its place, malformed JSON, a permissions error — is reported as unreadable
 * so the caller can refuse to trust the cache beside it, rather than silently
 * behaving as though provenance had never been recorded.
 */
async function readSourceMarker(sourceDir: string): Promise<SourceMarker> {
  let raw: string;
  try {
    raw = await readFile(path.join(sourceDir, SOURCE_MARKER), 'utf-8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
  }

  try {
    const parsed = JSON.parse(raw) as { contentRoot?: unknown };
    return typeof parsed.contentRoot === 'string'
      ? { kind: 'present', contentRoot: parsed.contentRoot }
      : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

/** Write the provenance marker atomically, so a reader never sees a partial file. */
async function writeSourceMarker(sourceDir: string, contentRoot: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true });
  const target = path.join(sourceDir, SOURCE_MARKER);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify({ contentRoot }, null, 2)}\n`, 'utf-8');
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw new Error(
      `Could not record the cache provenance for ${sourceDir}: ${err instanceof Error ? err.message : String(err)}`,
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
