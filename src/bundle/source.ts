import { fetchDiscoveryDocument, type DiscoveryDocument } from '../discovery/index.js';
import { readConfig, orderedSources, type StoredSource } from './cache.js';
import {
  isRepoSource,
  resolveSkillSource,
  type RepoSkillSource,
} from './skill-source.js';

export type BundleSource =
  | { type: 'url'; baseUrl: string }
  | { type: 'directory'; dirPath: string }
  | { type: 'discovery'; baseUrl: string; discovery: DiscoveryDocument };

export type StartupSource = BundleSource | RepoSkillSource;

/**
 * Resolve a user-supplied startup source.
 *
 * Direct GitHub repository URLs are returned as repository sources so the TUI
 * can open its repository installation flow. Other URLs remain discovery base
 * URLs, and local directories retain the legacy bundle representation.
 *
 * Throws descriptive errors for invalid inputs.
 */
export async function resolveSource(input: string): Promise<StartupSource> {
  const source = await resolveSkillSource(input);

  if (isRepoSource(source)) {
    return source;
  }

  if (source.type === 'bundle' && source.dirPath) {
    return { type: 'directory', dirPath: source.dirPath };
  }

  const baseUrl = source.type === 'bundle' ? source.baseUrl : source.artefactUrl;
  const discovery = await fetchDiscoveryDocument(baseUrl!);
  return { type: 'discovery', baseUrl: baseUrl!, discovery };
}

export interface ResolvedPersistedSource {
  source: StartupSource;
  stored: StoredSource;
}

/**
 * Resolve a source from the persisted config for a bare `agentman` invocation.
 *
 * Sources are tried in order (active first). A source that fails to resolve —
 * host down, discovery document missing, path deleted — does not abort startup;
 * the next source is tried instead (per-source error isolation). Returns the
 * first source that resolves, or `null` when there are none configured. Throws
 * only when every configured source failed, aggregating their errors.
 */
export async function resolvePersistedSource(): Promise<ResolvedPersistedSource | null> {
  const config = await readConfig();
  const stored = orderedSources(config);
  if (stored.length === 0) {
    return null;
  }

  const failures: string[] = [];
  for (const entry of stored) {
    try {
      const source = await resolveSource(entry.value);
      return { source, stored: entry };
    } catch (error) {
      failures.push(`  - ${entry.value}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`None of the configured sources could be resolved:\n${failures.join('\n')}`);
}
