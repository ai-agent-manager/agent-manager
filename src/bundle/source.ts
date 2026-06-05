import path from 'node:path';
import { stat } from 'node:fs/promises';

export type BundleSource =
  | { type: 'url'; baseUrl: string }
  | { type: 'directory'; dirPath: string };

/**
 * Determine whether the user-supplied input is a URL or a local directory path.
 *
 * - Strings starting with http:// or https:// are treated as URL sources.
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
