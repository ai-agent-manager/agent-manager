import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fetchDiscoveryDocument, type DiscoveryDocument } from '../discovery/index.js';
import {
  gitRemoteToRepoSource,
  isGithubRepoShorthand,
  parseGitRemoteInput,
  probeGitDiscovery,
} from '../discovery/git-probe.js';
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

async function isExistingDirectory(input: string): Promise<boolean> {
  try {
    const stats = await stat(path.resolve(input));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a user-supplied startup source.
 *
 * Git remotes (GitHub HTTPS, `owner/repo` shorthand, `*.git`, `git@…`) are
 * probed for `.agents/discovery.json`. When that file exists the remote is a
 * discovery catalogue; when it does not, GitHub remotes fall back to the bare
 * skills-repo install path. An existing local directory wins over `owner/repo`
 * shorthand. Other http(s) URLs remain discovery base URLs.
 *
 * Throws descriptive errors for invalid inputs.
 */
export async function resolveSource(input: string): Promise<StartupSource> {
  // A real local directory must win over GitHub `owner/repo` shorthand —
  // otherwise `team/skills` on disk would silently become a remote probe.
  if (isGithubRepoShorthand(input) && (await isExistingDirectory(input))) {
    return { type: 'directory', dirPath: path.resolve(input) };
  }

  const gitRemote = parseGitRemoteInput(input);
  if (gitRemote) {
    const discovery = await probeGitDiscovery(gitRemote);
    if (discovery) {
      return { type: 'discovery', baseUrl: gitRemote.identity, discovery };
    }
    if (gitRemote.supportsDirectSkillInstall) {
      return gitRemoteToRepoSource(gitRemote);
    }
    throw new Error(
      `No discovery document found at .agents/discovery.json in ${gitRemote.identity}.\n` +
        `  Direct skill install from a git remote without a discovery document is only supported for GitHub repositories.`,
    );
  }

  const source = await resolveSkillSource(input);

  if (isRepoSource(source)) {
    // parseGitRemoteInput should have caught GitHub URLs above; keep this as a
    // safety net for custom githubHosts passed only to resolveSkillSource.
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

/**
 * Resolve a source for headless-entry telemetry without imposing TUI discovery
 * semantics on legacy HTTP / ZIP inputs.
 *
 * Git remotes (including `owner/repo` shorthand) use {@link resolveSource} so
 * the probe and shorthand expansion match the install path. Everything else
 * uses {@link resolveSkillSource} only — a missing discovery document must not
 * abort before `runHeadless`'s soft-404 fallback runs.
 */
export async function resolveHeadlessTelemetrySource(input: string): Promise<BundleSource> {
  if (parseGitRemoteInput(input)) {
    const startup = await resolveSource(input);
    if (startup.type === 'repo') {
      return { type: 'url', baseUrl: startup.repoUrl };
    }
    return startup;
  }

  const skill = await resolveSkillSource(input);
  if (skill.type === 'bundle' && skill.dirPath) {
    return { type: 'directory', dirPath: skill.dirPath };
  }
  if (skill.type === 'bundle') {
    return { type: 'url', baseUrl: skill.baseUrl ?? '' };
  }
  if (skill.type === 'repo') {
    return { type: 'url', baseUrl: skill.repoUrl };
  }
  return { type: 'url', baseUrl: skill.artefactUrl };
}
