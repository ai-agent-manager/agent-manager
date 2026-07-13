import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { getArtefactCacheDir, getTempDir } from '../config/paths.js';
import { trackTelemetryError, trackTelemetryEvent } from '../telemetry.js';
import { IntegrityError, verifyBundleHash } from './downloader.js';
import type { ArtefactSkillSource, SkillSourcePin } from './skill-source.js';

/** Name of the metadata file written alongside cached artefact content. */
export const ARTEFACT_META_FILE = '.artefact.json';

export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_EXTRACT_BYTES = 500 * 1024 * 1024; // 500 MB
export const MAX_EXTRACT_ENTRIES = 10_000;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * Validates an artefact URL: must be https (http allowed only for loopback).
 * Rejects redirect-to-http by design — callers use redirect: 'error'.
 */
export function enforceArtefactUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `Artefact URLs must use https: ${url}\n` +
        'Plain http is only allowed for localhost during local development.',
    );
  }
}

/**
 * Recursively removes symlinks that escape the root directory.
 * Skill packages have no legitimate use for symlinks — a zip containing one
 * that points outside the extract dir is either broken or malicious.
 */
export async function removeEscapingSymlinks(rootDir: string): Promise<string[]> {
  const removed: string[] = [];
  const resolvedRoot = await realpath(rootDir);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(fullPath).catch(() => null);
        if (!target || !target.startsWith(resolvedRoot + path.sep)) {
          await rm(fullPath);
          removed.push(fullPath);
        }
      } else if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(resolvedRoot);
  return removed;
}

/**
 * Recursively sums file sizes and entry counts in a directory.
 * Throws if either limit is exceeded.
 */
async function enforceExtractLimits(rootDir: string): Promise<void> {
  let totalBytes = 0;
  let totalEntries = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      totalEntries += 1;
      if (totalEntries > MAX_EXTRACT_ENTRIES) {
        throw new Error(
          `Artefact extraction aborted: exceeds ${MAX_EXTRACT_ENTRIES} entries (possible zip bomb).`,
        );
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const { size } = await lstat(fullPath);
        totalBytes += size;
        if (totalBytes > MAX_EXTRACT_BYTES) {
          throw new Error(
            `Artefact extraction aborted: extracted content exceeds ${MAX_EXTRACT_BYTES / 1024 / 1024} MB (possible zip bomb).`,
          );
        }
      }
    }
  }

  await walk(rootDir);
}

/** Metadata persisted in the artefact cache for reuse on cache hits. */
export interface ArtefactCacheMeta {
  artefactUrl: string;
  version: string;
  sha256: string | null;
  downloadedAt: string;
}

export interface ArtefactDownloadResult {
  /** Absolute path to the extracted artefact content */
  extractDir: string;
  /** Artefact name derived from the URL (used as the cache key) */
  name: string;
  /** Resolved artefact version (URL → embedded manifest → content hash) */
  version: string;
  /** SHA-256 hex digest of the downloaded zip, or null when served from a cache without one */
  sha256: string | null;
  /** Whether the archive was freshly downloaded (false = served from cache) */
  isNew: boolean;
}

export interface ArtefactDownloadOptions {
  /** Force re-download even if already cached */
  forceUpdate?: boolean;
}

const SEMVER_RE = /^v?\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;

/**
 * Parse the artefact name and (when derivable) version from an artefact URL.
 *
 * Version derivation rules, in priority order:
 *   1. Filename suffix:  .../my-skill-1.2.0.zip      → name "my-skill", version "1.2.0"
 *   2. Path segment:     .../my-skill/1.2.0/my-skill.zip → version from the segment
 *      preceding the filename when it is semver-shaped
 *   3. Otherwise version is null (resolved later from the embedded manifest
 *      or the content hash).
 *
 * The name is sanitised for safe use as a cache directory component.
 */
export function parseArtefactUrl(artefactUrl: string): { name: string; version: string | null } {
  const parsed = new URL(artefactUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? '';
  const base = fileName.replace(/\.zip$/i, '');

  // 1. Version embedded in the filename: <name>-<semver>.zip
  const suffixMatch = base.match(/^(.+?)[-_](v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/);
  if (suffixMatch) {
    return { name: sanitiseName(suffixMatch[1]), version: suffixMatch[2].replace(/^v/, '') };
  }

  // 2. Version as the path segment preceding the filename: <name>/<semver>/<file>.zip
  const parentSegment = segments[segments.length - 2];
  if (parentSegment && SEMVER_RE.test(parentSegment)) {
    return { name: sanitiseName(base), version: parentSegment.replace(/^v/, '') };
  }

  return { name: sanitiseName(base), version: null };
}

function sanitiseName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'artefact';
}

/**
 * Build the URL of the SHA-256 sidecar for an artefact zip.
 * Convention: append `.sha256` to the zip URL (matching bundle.zip.sha256).
 */
export function buildArtefactHashUrl(artefactUrl: string): string {
  const parsed = new URL(artefactUrl);
  parsed.pathname = `${parsed.pathname}.sha256`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * Fetch the SHA-256 sidecar for an artefact.
 *
 * Returns the hex-encoded hash if the sidecar exists, or `null` on 404/403
 * (sidecar unavailable — publishers are not required to provide one).
 * Throws on other HTTP errors.
 */
export async function fetchArtefactHash(artefactUrl: string): Promise<string | null> {
  const url = buildArtefactHashUrl(artefactUrl);
  enforceArtefactUrl(url);

  const response = await fetch(url, { redirect: 'error' });

  if (response.status === 404 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch hash sidecar: ${response.status} ${response.statusText} from ${url}`);
  }

  const text = await response.text();
  // Parse sha256sum format: "<hex-hash>  <filename>\n"
  const hash = text.trim().split(/\s+/)[0];

  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error(`Invalid hash sidecar content from ${url}: expected 64-char hex SHA-256`);
  }

  return hash.toLowerCase();
}

/**
 * Download and cache a published skill artefact zip.
 *
 * Flow:
 *   1. Derives name/version from the URL; checks cache at
 *      ~/.agentman/artefacts/<name>/<version>/ when the version is known up front
 *   2. Downloads the zip and computes its SHA-256
 *   3. Verifies integrity against source.sha256 or the `.sha256` sidecar
 *      (skipped with a warning when neither is available)
 *   4. Extracts, resolves the final version (URL → embedded manifest.json →
 *      content-hash fallback), and moves into the permanent cache location
 *   5. Writes .artefact.json metadata so cache hits can restore the pin
 *
 * Throws IntegrityError on hash mismatch (the downloaded zip is deleted).
 */
export async function downloadArtefact(
  source: ArtefactSkillSource,
  options: ArtefactDownloadOptions = {},
): Promise<ArtefactDownloadResult> {
  const { name, version: versionFromUrl } = parseArtefactUrl(source.artefactUrl);

  trackTelemetryEvent({
    action: 'artefact_download_started',
    properties: { artefactUrl: source.artefactUrl, name },
  });

  // Cache hit — only possible when the version is derivable from the URL.
  // The cache key is <name>/<version> (both filename-derived), so two
  // different URLs can collide on the same key: the cached entry is only
  // valid for the URL it was downloaded from. An explicitly pinned sha256
  // must also match the cached hash, otherwise fall through to a fresh
  // download so verification runs against the pin.
  if (!options.forceUpdate && versionFromUrl) {
    const cached = await readCacheMeta(getArtefactCacheDir(name, versionFromUrl));
    if (
      cached &&
      cached.artefactUrl === source.artefactUrl &&
      (!source.sha256 || cached.sha256 === source.sha256.toLowerCase())
    ) {
      return {
        extractDir: getArtefactCacheDir(name, versionFromUrl),
        name,
        version: cached.version,
        sha256: cached.sha256,
        isNew: false,
      };
    }
  }

  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });
  const stamp = Date.now();
  const zipPath = path.join(tempDir, `artefact-${name}-${stamp}.zip`);
  const tempExtractDir = path.join(tempDir, `artefact-extract-${name}-${stamp}`);

  try {
    // Validate URL scheme before making any network request
    enforceArtefactUrl(source.artefactUrl);

    // Download — reject redirects to prevent cross-scheme downgrade
    const response = await fetch(source.artefactUrl, {
      headers: { 'User-Agent': 'agentman' },
      redirect: 'error',
    });

    if (!response.ok) {
      throw new Error(
        buildDownloadError(response.status, response.statusText, source.artefactUrl),
      );
    }

    // Reject oversized downloads before buffering (Content-Length may be absent or spoofed —
    // the actual buffer size check below is the hard limit)
    const contentLength = Number(response.headers?.get('content-length') ?? 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Artefact download rejected: Content-Length ${contentLength} exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit.`,
      );
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Artefact download rejected: actual size ${buffer.byteLength} bytes exceeds ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB limit.`,
      );
    }

    await writeFile(zipPath, new Uint8Array(buffer));

    const actualSha256 = createHash('sha256').update(new Uint8Array(buffer)).digest('hex');

    // Integrity verification: explicit pin takes precedence over the sidecar
    const expectedHash = source.sha256?.toLowerCase() ?? (await fetchArtefactHash(source.artefactUrl));
    if (expectedHash) {
      try {
        await verifyBundleHash(zipPath, expectedHash);
      } catch (error) {
        if (error instanceof IntegrityError) {
          await rm(zipPath, { force: true });
        }
        throw error;
      }
    } else {
      console.warn(
        `Warning: No SHA-256 available for ${source.artefactUrl}. Skipping integrity check.`,
      );
    }

    // Extract
    await mkdir(tempExtractDir, { recursive: true });
    await extractZip(zipPath, { dir: tempExtractDir });

    // Security: remove symlinks that escape the extract directory
    const escapingLinks = await removeEscapingSymlinks(tempExtractDir);
    if (escapingLinks.length > 0) {
      console.warn(
        `Warning: Removed ${escapingLinks.length} symlink(s) escaping the artefact directory.`,
      );
    }

    // Security: reject zip bombs by checking extracted size and entry count
    await enforceExtractLimits(tempExtractDir);

    // Resolve the final version: URL → embedded manifest.json → content hash
    const version =
      versionFromUrl ??
      (await readEmbeddedManifestVersion(tempExtractDir)) ??
      `sha-${actualSha256.slice(0, 12)}`;

    const cacheDir = getArtefactCacheDir(name, version);

    // A non-URL-versioned re-run may already have this version cached.
    // Reuse only when the content matches; otherwise replace the stale copy.
    const existing = await readCacheMeta(cacheDir);
    if (!options.forceUpdate && existing && existing.sha256 === actualSha256) {
      return { extractDir: cacheDir, name, version, sha256: actualSha256, isNew: false };
    }

    await writeFile(
      path.join(tempExtractDir, ARTEFACT_META_FILE),
      JSON.stringify(
        {
          artefactUrl: source.artefactUrl,
          version,
          sha256: actualSha256,
          downloadedAt: new Date().toISOString(),
        } satisfies ArtefactCacheMeta,
        null,
        2,
      ),
    );

    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(path.dirname(cacheDir), { recursive: true });
    await rename(tempExtractDir, cacheDir);

    trackTelemetryEvent({
      action: 'artefact_download_succeeded',
      properties: { artefactUrl: source.artefactUrl, name, version },
    });

    return { extractDir: cacheDir, name, version, sha256: actualSha256, isNew: true };
  } catch (error) {
    trackTelemetryError('artefact_download_failed', error, {
      artefactUrl: source.artefactUrl,
      name,
    });
    throw error;
  } finally {
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ArtefactUpdateCheckResult {
  /** True when the published artefact's hash differs from the pinned one */
  updateAvailable: boolean;
  /** SHA-256 pinned at install time, if recorded */
  pinnedSha256?: string;
  /** SHA-256 currently published at the artefact URL, or null when no sidecar exists */
  remoteSha256: string | null;
}

/**
 * Check whether a newer artefact has been published at the pinned URL.
 *
 * Compares the remote `.sha256` sidecar against the hash pinned at install
 * time. The pin itself is never mutated — version pinning remains stable
 * across update checks; acting on an available update is a separate,
 * explicit install step.
 *
 * Returns updateAvailable: false when the pin has no hash or the remote
 * sidecar is unavailable (no way to compare).
 */
export async function checkArtefactUpdate(pin: SkillSourcePin): Promise<ArtefactUpdateCheckResult> {
  if (pin.sourceType !== 'artefact' || !pin.artefactUrl) {
    throw new Error('checkArtefactUpdate requires an artefact source pin with an artefactUrl');
  }

  const remoteSha256 = await fetchArtefactHash(pin.artefactUrl);

  return {
    updateAvailable: Boolean(remoteSha256 && pin.sha256 && remoteSha256 !== pin.sha256.toLowerCase()),
    pinnedSha256: pin.sha256,
    remoteSha256,
  };
}

/** Read cached artefact metadata; null when absent or unreadable (treated as a cache miss). */
async function readCacheMeta(cacheDir: string): Promise<ArtefactCacheMeta | null> {
  try {
    const raw = await readFile(path.join(cacheDir, ARTEFACT_META_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as ArtefactCacheMeta;
    if (!parsed.version || typeof parsed.version !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the version field from an embedded manifest.json, if present and valid. */
async function readEmbeddedManifestVersion(extractDir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(extractDir, 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : null;
  } catch {
    return null;
  }
}

function buildDownloadError(status: number, statusText: string, artefactUrl: string): string {
  if (status === 404) {
    return (
      `Artefact not found: ${artefactUrl}\n` +
      `  Check the URL and ensure the artefact has been published.`
    );
  }
  if (status === 401 || status === 403) {
    return (
      `Access denied for ${artefactUrl}\n` +
      `  Ensure you have permission to download this artefact.`
    );
  }
  return `Failed to download artefact: ${status} ${statusText} from ${artefactUrl}`;
}
