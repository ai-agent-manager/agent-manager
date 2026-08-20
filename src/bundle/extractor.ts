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

/**
 * Provenance recorded inside each cached version, published by the same rename
 * that publishes the content. Being per-version is what matters: a source-level
 * file gates reuse for versions it never attested, so writing one while
 * repairing a single version silently vouches for its siblings.
 */
const VERSION_MARKER = '.source.json';

/**
 * Source-level record of the content root, kept for collision *detection* only
 * — two documents declaring one source name are worth reporting even when they
 * ask for different versions. It never authorises reuse; only the per-version
 * marker does.
 */
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
    let reusable = true;
    if (sourceDir && contentRoot) {
      // Reported even when the requested version differs, so two documents
      // sharing a source name surface as an error rather than quietly
      // accumulating side by side in one cache.
      const declared = await readProvenance(path.join(sourceDir, SOURCE_MARKER));
      if (declared.kind === 'present' && declared.contentRoot !== contentRoot) {
        throw collisionError(options.sourceKey!, declared.contentRoot, contentRoot, sourceDir);
      }

      const attested = await readProvenance(path.join(targetDir, VERSION_MARKER));
      if (attested.kind === 'present' && attested.contentRoot !== contentRoot) {
        throw collisionError(options.sourceKey!, attested.contentRoot, contentRoot, sourceDir);
      }

      // Only this version's own provenance may authorise reuse. Absent or
      // unreadable means these contents cannot be attributed, so they are
      // replaced rather than vouched for.
      reusable = attested.kind === 'present';
    }

    if (reusable && (await dirExists(targetDir))) {
      // Clean up temp extraction
      await rm(tempExtractDir, { recursive: true, force: true });
      return { manifest, bundleDir: targetDir, isNew: false };
    }

    // Written into the staging directory so the rename below publishes content
    // and provenance together — there is no window in which the version is
    // visible without the record of where it came from. A bundle shipping its
    // own file by this name would have it replaced in the cache; the leading dot
    // keeps it out of the scanner's way, which skips dotfiles and non-directories.
    if (sourceDir && contentRoot) {
      await writeFile(
        path.join(tempExtractDir, VERSION_MARKER),
        `${JSON.stringify({ contentRoot }, null, 2)}\n`,
        'utf-8',
      );
    }

    // Move to the permanent cache location
    await mkdir(path.dirname(targetDir), { recursive: true });
    // Use rename-like approach: extract directly to target
    await rm(targetDir, { recursive: true, force: true });
    await rename(tempExtractDir, targetDir);

    // Detection only, and deliberately after the version is published: losing
    // this file costs an error message, never the reuse guarantee above.
    if (sourceDir && contentRoot) {
      await writeSourceMarker(sourceDir, contentRoot);
    }

    return { manifest, bundleDir: targetDir, isNew: true };
  } catch (error) {
    // Clean up on failure
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

type Provenance = { kind: 'present'; contentRoot: string } | { kind: 'absent' } | { kind: 'unreadable' };

function collisionError(
  sourceKey: string,
  cached: string,
  requested: string,
  sourceDir: string,
): Error {
  return new Error(
    `Source '${sourceKey}' is already cached from a different content root. ` +
      `Cached: ${cached}. Requested: ${requested}. ` +
      `Two discovery documents are using one source name for different publishers; ` +
      `rename one of them, or remove ${sourceDir} to start over.`,
  );
}

/**
 * Read a provenance record.
 *
 * Only a missing file counts as "absent". Every other failure — a directory in
 * its place, malformed JSON, a permissions error, a URL that no longer
 * canonicalises — is reported as unreadable, so the caller refuses to trust the
 * cache beside it rather than behaving as though provenance had never been
 * recorded. The stored value is canonicalised on read as well as on write, so a
 * record written by an earlier build still compares equal to the same URL.
 */
async function readProvenance(markerPath: string): Promise<Provenance> {
  let raw: string;
  try {
    raw = await readFile(markerPath, 'utf-8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable' };
  }

  try {
    const parsed = JSON.parse(raw) as { contentRoot?: unknown };
    if (typeof parsed.contentRoot !== 'string') return { kind: 'unreadable' };
    return { kind: 'present', contentRoot: canonicaliseContentRoot(parsed.contentRoot) };
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * Write the source-level detection record atomically, so a reader never sees a
 * partial file. Best effort: this file only sharpens an error message, so a
 * failure to write it must not fail an otherwise complete extraction. Anything
 * squatting on the path is cleared first, since it can only be leftover state.
 */
async function writeSourceMarker(sourceDir: string, contentRoot: string): Promise<void> {
  const target = path.join(sourceDir, SOURCE_MARKER);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(sourceDir, { recursive: true });
    await writeFile(temp, `${JSON.stringify({ contentRoot }, null, 2)}\n`, 'utf-8');
    await rm(target, { recursive: true, force: true });
    await rename(temp, target);
  } catch {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
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
