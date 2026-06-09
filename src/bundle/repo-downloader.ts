import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { getRepoCacheDir, getTempDir } from '../config/paths.js';
import { trackTelemetryError, trackTelemetryEvent } from '../telemetry.js';
import type { RepoSkillSource } from './skill-source.js';

export interface RepoDownloadResult {
  /** Absolute path to the extracted repository content */
  extractDir: string;
  /** Whether the archive was freshly downloaded (false = served from cache) */
  isNew: boolean;
}

export interface RepoDownloadOptions {
  /** Force re-download even if already cached */
  forceUpdate?: boolean;
  /** GitHub personal access token for private repositories */
  token?: string;
}

/**
 * Parse owner and repo name from a GitHub repository URL.
 * Supports https://github.com/owner/repo and GHES variants.
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const parsed = new URL(repoUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      `Invalid GitHub repository URL: "${repoUrl}". Expected format: https://github.com/owner/repo`,
    );
  }
  const repo = segments[1].replace(/\.git$/i, '');
  return { owner: segments[0], repo };
}

/**
 * Build the GitHub archive download URL for a given repo and ref.
 * Works for branches, tags, and commit SHAs.
 */
export function buildArchiveUrl(repoUrl: string, ref: string): string {
  const parsed = new URL(repoUrl);
  return `${parsed.origin}${parsed.pathname}/archive/${ref}.zip`;
}

/**
 * Download and cache a GitHub repository archive for skill installation.
 *
 * Flow:
 *   1. Checks cache at ~/.agentman/repos/<owner>/<repo>/<ref>/
 *   2. Returns cache hit immediately when !forceUpdate
 *   3. Downloads archive zip from GitHub
 *   4. Extracts and strips GitHub's top-level wrapper directory
 *   5. Moves to permanent cache location
 *   6. Cleans up temp files
 *
 * Supports GITHUB_TOKEN via options.token for private repositories.
 * Throws descriptive errors for 404, auth failures, and network issues.
 */
export async function downloadRepoArchive(
  source: RepoSkillSource,
  options: RepoDownloadOptions = {},
): Promise<RepoDownloadResult> {
  const { owner, repo } = parseRepoUrl(source.repoUrl);
  const ref = source.ref ?? source.defaultBranch ?? 'main';
  const cacheDir = getRepoCacheDir(owner, repo, ref);

  trackTelemetryEvent({
    action: 'repo_download_started',
    properties: { owner, repo, ref },
  });

  // Cache hit — return immediately unless forced
  if (!options.forceUpdate) {
    const alreadyCached = await dirExists(cacheDir);
    if (alreadyCached) {
      return { extractDir: cacheDir, isNew: false };
    }
  }

  const archiveUrl = buildArchiveUrl(source.repoUrl, ref);
  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });
  const zipPath = path.join(tempDir, `${owner}-${repo}-${ref}.zip`);
  const tempExtractDir = path.join(tempDir, `extract-${owner}-${repo}-${ref}-${Date.now()}`);

  try {
    // Download archive
    const headers: Record<string, string> = { 'User-Agent': 'agentman' };
    if (options.token) {
      headers['Authorization'] = `token ${options.token}`;
    }

    const response = await fetch(archiveUrl, { headers });

    if (!response.ok) {
      const message = buildDownloadError(response.status, response.statusText, source.repoUrl, archiveUrl);
      throw new Error(message);
    }

    const buffer = await response.arrayBuffer();
    await writeFile(zipPath, new Uint8Array(buffer));

    // Extract to temp dir
    await mkdir(tempExtractDir, { recursive: true });
    await extractZip(zipPath, { dir: tempExtractDir });

    // Strip GitHub's top-level wrapper directory (<repo>-<ref>/ or <repo>-<sha>/)
    const entries = await readdir(tempExtractDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length !== 1) {
      throw new Error(
        `Unexpected archive structure from ${archiveUrl}: expected a single top-level directory, found ${dirs.length}`,
      );
    }
    const innerDir = path.join(tempExtractDir, dirs[0].name);

    // Move to permanent cache location (remove stale cache first if force-updating)
    await rm(cacheDir, { recursive: true, force: true });
    await mkdir(path.dirname(cacheDir), { recursive: true });
    await rename(innerDir, cacheDir);

    trackTelemetryEvent({
      action: 'repo_download_succeeded',
      properties: { owner, repo, ref },
    });

    return { extractDir: cacheDir, isNew: true };
  } catch (error) {
    trackTelemetryError('repo_download_failed', error, { owner, repo, ref });
    throw error;
  } finally {
    // Always clean up temp files
    await rm(zipPath, { force: true }).catch(() => {});
    await rm(tempExtractDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildDownloadError(
  status: number,
  statusText: string,
  repoUrl: string,
  archiveUrl: string,
): string {
  if (status === 404) {
    return (
      `Repository not found: ${repoUrl}\n` +
      `  Check the URL and ensure the repository exists and is accessible.`
    );
  }
  if (status === 401 || status === 403) {
    return (
      `Authentication required for ${repoUrl}\n` +
      `  Set the GITHUB_TOKEN environment variable to a personal access token with repo read access.`
    );
  }
  return `Failed to download repository archive: ${status} ${statusText} from ${archiveUrl}`;
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
