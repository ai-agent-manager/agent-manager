import { createHash } from 'node:crypto';
import { readFile, realpath, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { getBundlesDir, getBundleVersionDir } from '../config/paths.js';
import { assertSafeCacheSegment } from '../lib/path-segment.js';
import { OperationConflictError } from '../lib/mutation.js';
import { canonicaliseContentRoot } from './downloader.js';
import { bundleSourceKey, type SkillSourcePin } from './skill-source.js';
import { parseManifest } from './manifest.js';

export interface BundleIdentity {
  bundleId: string;
  version: string;
  published: string;
  bundleDir: string;
  contentRoot?: string;
  directory?: string;
  directoryAliases?: string[];
  origin: string;
  trackedReferences: boolean;
}

export function assertBundleVersion(version: string): void {
  assertSafeCacheSegment(version, 'Bundle version');
  if (version === 'sources' || version === 'source.json') throw new OperationConflictError('Reserved bundle version');
}

/** Validate every directory component as well as the final real path. */
export async function assertCachePath(bundleDir: string): Promise<void> {
  const root = path.resolve(getBundlesDir());
  const relative = path.relative(root, path.resolve(bundleDir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new OperationConflictError('Bundle path is outside the cache');
  let cursor = root;
  if (await realpath(root) !== root) throw new OperationConflictError('Bundle cache root must not be a symlink');
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (await realpath(cursor) !== cursor) throw new OperationConflictError('Bundle cache paths must not contain symlinks');
  }
}

/** Check existing ancestors before publishing a previously absent entry. */
export async function assertCacheDestination(bundleDir: string): Promise<void> {
  const root = path.resolve(getBundlesDir());
  const relative = path.relative(root, path.resolve(bundleDir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new OperationConflictError('Bundle path is outside the cache');
  let cursor = root;
  for (const segment of ['', ...relative.split(path.sep)]) {
    if (segment) cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new OperationConflictError('Bundle cache paths must not contain symlinks');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export async function readBundleIdentity(bundleDir: string): Promise<BundleIdentity> {
  try {
    await assertCachePath(bundleDir);
    await assertCachePath(path.join(bundleDir, 'manifest.json'));
    await assertCachePath(path.join(bundleDir, '.source.json'));
    const manifest = parseManifest(await readFile(path.join(bundleDir, 'manifest.json'), 'utf8'));
    assertBundleVersion(manifest.version);
    if (path.basename(bundleDir) !== manifest.version) throw new Error('Manifest version does not match cache directory');
    const marker = JSON.parse(await readFile(path.join(bundleDir, '.source.json'), 'utf8'));
    const contentRoot = typeof marker.contentRoot === 'string' ? canonicaliseContentRoot(marker.contentRoot) : undefined;
    const directory = typeof marker.directory === 'string' && path.isAbsolute(marker.directory) ? marker.directory : undefined;
    if ((!contentRoot && !directory) || (contentRoot && directory)) throw new Error('Invalid origin');
    const directoryAliases: string[] = directory && Array.isArray(marker.directoryAliases)
      ? marker.directoryAliases.filter((value: unknown): value is string => typeof value === 'string' && path.isAbsolute(value)) : [];
    const origin = contentRoot ? `url:${contentRoot}` : `directory:${directory}`;
    return {
      bundleId: createHash('sha256').update(JSON.stringify([bundleDir, origin, manifest.version])).digest('hex'),
      version: manifest.version, published: manifest.published, bundleDir, contentRoot, directory, directoryAliases, origin,
      trackedReferences: marker.trackedReferences === true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new OperationConflictError('This cached version has no verified origin. Download or import it again from its original source, or remove it if unused.');
    if (error instanceof OperationConflictError) throw error;
    throw new OperationConflictError('Cannot verify this cached version: its manifest or origin metadata is invalid. Reacquire it from the original source.');
  }
}

export function versionSupportReason(pin?: SkillSourcePin): string | undefined {
  if (!pin) return 'No source pin is recorded. Reinstall from the original source first.';
  if (pin.sourceType !== 'bundle') return 'Version switching is available only for bundle installs; update this source instead.';
  if (!pin.bundleBaseUrl && !pin.bundleDirectory && !pin.bundleVersion) return 'This local installation has no recorded origin. Import it again from its original directory.';
  return undefined;
}

export function bundleDirectoryForPin(pin: SkillSourcePin, version: string): string {
  assertBundleVersion(version);
  return pin.bundleSourceName
    ? path.join(getBundlesDir(), 'sources', bundleSourceKey(pin.bundleSourceName), version)
    : getBundleVersionDir(version);
}

export async function resolvePinnedBundle(pin: SkillSourcePin | undefined, version: string): Promise<BundleIdentity> {
  const reason = versionSupportReason(pin);
  if (reason) throw new OperationConflictError(reason);
  const candidate = await readBundleIdentity(bundleDirectoryForPin(pin!, version));
  const expected = pin!.bundleBaseUrl
    ? `url:${canonicaliseContentRoot(pin!.bundleBaseUrl)}`
    : pin!.bundleDirectory
      ? `directory:${await realpath(pin!.bundleDirectory).catch(() => path.resolve(pin!.bundleDirectory!))}`
      : (await readBundleIdentity(bundleDirectoryForPin(pin!, pin!.bundleVersion ?? ''))).origin;
  if ((!pin!.bundleBaseUrl && !candidate.directory) || candidate.origin !== expected && !candidate.directoryAliases?.some((directory) => expected === `directory:${directory}`)) {
    throw new OperationConflictError('The cached bundle belongs to a different source.');
  }
  return candidate;
}

export async function listPinnedBundles(pin?: SkillSourcePin): Promise<{ bundles: BundleIdentity[]; unsupportedReason?: string }> {
  const unsupportedReason = versionSupportReason(pin);
  if (unsupportedReason) return { bundles: [], unsupportedReason };
  try {
    // Validate the installed coordinate too; a pin alone cannot attest old content.
    await resolvePinnedBundle(pin, pin!.bundleVersion ?? '');
    const parent = path.dirname(bundleDirectoryForPin(pin!, pin!.bundleVersion!));
    const bundles: BundleIdentity[] = [];
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'sources') continue;
      try { bundles.push(await resolvePinnedBundle(pin, entry.name)); }
      catch { /* Unattested or other-source entries cannot be selected. */ }
    }
    return { bundles };
  } catch (error) {
    return { bundles: [], unsupportedReason: error instanceof Error ? error.message : String(error) };
  }
}
