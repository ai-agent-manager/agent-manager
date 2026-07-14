import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fetchDiscoveryDocument, type DiscoveryDocument } from '../discovery/index.js';

export type BundleSource =
  | { type: 'url'; baseUrl: string }
  | { type: 'directory'; dirPath: string }
  | { type: 'discovery'; baseUrl: string; discovery: DiscoveryDocument };

/**
 * Determine whether the user-supplied input is a URL or a local directory path.
 *
 * - Strings starting with http:// or https:// are treated as URL sources.
 *   The discovery document is fetched from the well-known path. If it cannot
 *   be found or is invalid, the error is propagated (no fallback).
 * - Everything else is treated as a filesystem path (resolved to absolute).
 *   The path must exist and be a directory. manifest.json is optional.
 *
 * Throws descriptive errors for invalid inputs.
 *
 * @deprecated Use `resolveSkillSource()` from './skill-source.js' instead,
 * which returns a first-class `SkillSource` (repo | artefact | bundle) rather
 * than the legacy `BundleSource` (url | directory).
 *
 * Retained for backward compatibility until existing callers are migrated to
 * the multi-source model. Do not add new callers.
 */
export async function resolveSource(input: string): Promise<BundleSource> {
  if (/^https?:\/\//i.test(input)) {
    // Validate it parses as a URL
    new URL(input);

    const discovery = await fetchDiscoveryDocument(input);
    return { type: 'discovery', baseUrl: input, discovery };
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
