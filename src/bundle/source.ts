import path from 'node:path';
import { stat } from 'node:fs/promises';
// SHIM: git source support — to be superseded by discovery mechanism (PR #16, PR #14)
import { isGitSource, resolveGitSource } from '../discovery/git-source-shim.js';

export type BundleSource =
  | { type: 'url'; baseUrl: string }
  | { type: 'directory'; dirPath: string }
  | { type: 'git'; repoUrl: string };

/**
 * Determine whether the user-supplied input is a URL or a local directory path.
 *
 * - Strings starting with http:// or https:// are treated as URL sources.
 * - Everything else is treated as a filesystem path (resolved to absolute).
 *   The path must exist and be a directory. manifest.json is optional.
 *
 * Throws descriptive errors for invalid inputs.
 */
export async function resolveSource(input: string, typeHint?: string): Promise<BundleSource> {
  // SHIM: git source detection — to be superseded by discovery mechanism (PR #16, PR #14)
  if (isGitSource(input, typeHint)) {
    return resolveGitSource(input);
  }

  if (/^https?:\/\//i.test(input)) {
    // Validate it parses as a URL
    new URL(input);
    return { type: 'url', baseUrl: input };
  }

  const dirPath = path.resolve(input);

  let stats;
  try {
    stats = await stat(dirPath);
  } catch {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  return { type: 'directory', dirPath };
}
