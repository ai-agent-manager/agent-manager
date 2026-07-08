/**
 * Multi-source skill model for agentman.
 *
 * Replaces the previous two-variant BundleSource (url | directory) with a
 * first-class three-way discriminated union:
 *
 *   repo      — install directly from a GitHub repository
 *   artefact  — install from a packaged, versioned zip artefact
 *   bundle    — legacy bundle path (CDN url or local directory)
 *
 * Type constants (SkillSourceType, InstallLayout) are intended to stay in sync
 * with the canonical skill-manifest contract. A future task will consolidate
 * these by importing from a shared package once it is published.
 *
 * Backward compatibility: BundleSource (url | directory) is preserved as a
 * legacy path that maps to the 'bundle' source type with installLayout 'flat'.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Primitive types ───────────────────────────────────────────────────────────

export type SkillSourceType = 'repo' | 'artefact' | 'bundle';

/**
 * Install layout strategy.
 *   namespaced — <namespace>/<skillId>/ (recommended for multi-origin installs)
 *   flat       — <skillId>/ (legacy bundle behaviour)
 */
export type InstallLayout = 'namespaced' | 'flat';

// ── Source variant types ──────────────────────────────────────────────────────

/**
 * Repo source: install directly from a GitHub repository.
 * The scanner derives this from discovered repositories.
 * Users can supply a GitHub URL to target a specific repo/branch/tag.
 */
export interface RepoSkillSource {
  type: 'repo';
  /** Full GitHub repository URL, e.g. "https://github.com/org/repo". */
  repoUrl: string;
  /** Actual default branch of the repository (main, master, develop, …). */
  defaultBranch?: string;
  /** Pinned branch, tag, or commit SHA. Defaults to defaultBranch. */
  ref?: string;
  /** Path within the repo from root, e.g. "skills/api-backend-skill". */
  skillPath?: string;
  installLayout: InstallLayout;
}

/**
 * Artefact source: install from a versioned, packaged zip artefact.
 * URLs ending in .zip are resolved to this source type.
 */
export interface ArtefactSkillSource {
  type: 'artefact';
  /** CDN or direct URL to the packaged skill zip. */
  artefactUrl: string;
  /** Optional SHA-256 hex digest for integrity verification. */
  sha256?: string;
  installLayout: InstallLayout;
}

/**
 * Bundle source: legacy compatibility path.
 * Maps to the previous BundleSource (url | directory) model.
 * Exactly one of baseUrl or dirPath will be set.
 */
export interface BundleSkillSource {
  type: 'bundle';
  /** Base URL of a CDN-hosted bundle (legacy url source). */
  baseUrl?: string;
  /** Absolute path to a local bundle directory (legacy directory source). */
  dirPath?: string;
  installLayout: InstallLayout;
}

/** Discriminated union of all supported skill source types. */
export type SkillSource = RepoSkillSource | ArtefactSkillSource | BundleSkillSource;

// ── Source pin ────────────────────────────────────────────────────────────────

/**
 * Pinned source coordinate — the resolved form of a SkillSource, persisted in
 * install records so agentman can reproduce or track the exact install later.
 *
 * Intentional divergences from the canonical manifest SourceCoordinate shape:
 *   - bundleBaseUrl  present here; absent from SourceCoordinate (local-only concept)
 *   - defaultBranch  present in SourceCoordinate; absent here (not needed at pin time)
 *
 * The pin records what was actually installed locally, while SourceCoordinate
 * describes the published catalogue coordinate. These two shapes should be
 * mappable to each other without loss of information.
 */
export interface SkillSourcePin {
  sourceType: SkillSourceType;
  installLayout: InstallLayout;
  // Repo fields
  repoUrl?: string;
  /** Pinned git ref (branch, tag, or commit SHA). */
  ref?: string;
  skillPath?: string;
  // Artefact fields
  artefactUrl?: string;
  sha256?: string;
  // Bundle fields (legacy)
  bundleVersion?: string;
  bundleBaseUrl?: string;
}

// ── Type guards ───────────────────────────────────────────────────────────────

/** Type guard: narrows SkillSource to RepoSkillSource. */
export function isRepoSource(s: SkillSource): s is RepoSkillSource {
  return s.type === 'repo';
}

/** Type guard: narrows SkillSource to ArtefactSkillSource. */
export function isArtefactSource(s: SkillSource): s is ArtefactSkillSource {
  return s.type === 'artefact';
}

/** Type guard: narrows SkillSource to BundleSkillSource. */
export function isBundleSource(s: SkillSource): s is BundleSkillSource {
  return s.type === 'bundle';
}

// ── URL detection helpers ─────────────────────────────────────────────────────

/**
 * Default list of known GitHub hosts used when resolving repo sources.
 * Override via ResolveSkillSourceOptions.githubHosts to support GitHub
 * Enterprise Server (GHES) deployments (e.g. "github.acme-corp.com").
 */
export const GITHUB_HOSTS_DEFAULT: readonly string[] = ['github.com'];

function isGithubRepoParsed(parsed: URL, knownHosts: readonly string[]): boolean {
  const segments = parsed.pathname.split('/').filter(Boolean);
  return knownHosts.includes(parsed.hostname) && segments.length >= 2;
}

/**
 * Detect whether a URL points to a skill artefact (zip file).
 * Matches http(s) URLs whose path ends with .zip (ignoring query strings).
 */
export function isArtefactUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.zip');
  } catch {
    return false;
  }
}

// ── Source resolution ─────────────────────────────────────────────────────────

export interface ResolveSkillSourceOptions {
  /**
   * Default branch to use when a GitHub URL has no /tree/<ref> path segment.
   * Defaults to 'main'.
   *
   * Known limitation: for raw GitHub URLs without a /tree/ segment, the default
   * branch is assumed rather than resolved from the GitHub API. Callers that
   * need exact accuracy should resolve the actual default branch via the API
   * and pass it here, to avoid incorrect assumptions on repos that use 'master',
   * 'develop', or other conventions.
   */
  defaultBranch?: string;
  /**
   * Install layout to assign.
   * - Repo and artefact sources default to 'namespaced'.
   * - Bundle sources default to 'flat' (legacy behaviour).
   */
  installLayout?: InstallLayout;
  /**
   * Specific skill path within a repo (e.g. "skills/my-skill").
   * Only relevant for repo sources.
   */
  skillPath?: string;
  /**
   * List of GitHub hostnames to recognise as repo sources.
   * Defaults to GITHUB_HOSTS_DEFAULT (['github.com']).
   *
   * Set this to support GitHub Enterprise Server (GHES) deployments.
   * Example: ['github.com', 'github.acme-corp.com']
   */
  githubHosts?: readonly string[];
}

/**
 * Resolve a user-supplied input string into a typed SkillSource.
 *
 * Resolution rules (in priority order):
 *   1. http(s) URL with .zip path                        → artefact source
 *   2. https://<github-host>/<org>/<repo>[/tree/<ref>]  → repo source
 *   3. Other http(s) URL                                 → bundle source (legacy url path)
 *   4. Local path that is a directory                    → bundle source (legacy directory path)
 *
 * Artefact is checked before repo so GitHub release-asset .zip URLs
 * (github.com/org/repo/releases/download/v1.0/skill.zip) resolve correctly.
 *
 * GitHub URL path handling:
 *   /org/repo                   → ref defaults to options.defaultBranch ?? 'main'
 *   /org/repo/tree/<ref>        → ref pinned to <ref>
 *   /org/repo/tree/<ref>/<path> → ref pinned, trailing path warned and ignored
 *   /org/repo/issues/5          → NOT treated as a pinned ref (non-tree path ignored)
 *
 * Throws descriptive errors for invalid inputs or non-existent local paths.
 */
export async function resolveSkillSource(
  input: string,
  options: ResolveSkillSourceOptions = {},
): Promise<SkillSource> {
  const knownHosts = options.githubHosts ?? GITHUB_HOSTS_DEFAULT;

  // ── URL inputs ──────────────────────────────────────────────────────────────
  if (/^https?:\/\//i.test(input)) {
    // Parse once — reused for all subsequent checks to avoid triple-parse.
    const parsed = new URL(input); // throws TypeError on invalid URL

    // ── Artefact source — checked before repo to catch GitHub release-asset .zip URLs ──
    if (parsed.pathname.toLowerCase().endsWith('.zip')) {
      return {
        type: 'artefact',
        artefactUrl: input,
        installLayout: options.installLayout ?? 'namespaced',
      };
    }

    // ── Repo source ──
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (isGithubRepoParsed(parsed, knownHosts)) {
      const [org, repo, treeSegment, refFromPath] = segments;
      const defaultBranch = options.defaultBranch ?? 'main';
      // Only treat the 4th segment as a ref when the 3rd is literally 'tree'.
      // Other path shapes (/issues/, /pulls/, /blob/) are not ref specifiers.
      const ref = (treeSegment === 'tree' && refFromPath) ? refFromPath : defaultBranch;

      // Warn when the URL has path segments after the ref — e.g. /tree/main/skills/my-skill.
      // agentman uses a list-and-choose model, so the path is redundant, but silent loss is confusing.
      if (treeSegment === 'tree' && segments.length > 4) {
        console.warn(
          `[agentman] The path after the ref in "${input}" is ignored. ` +
          `Select the skill from the list after resolving the repo.`,
        );
      }

      const source: RepoSkillSource = {
        type: 'repo',
        repoUrl: `${parsed.origin}/${org}/${repo}`,
        defaultBranch,
        ref,
        installLayout: options.installLayout ?? 'namespaced',
      };
      if (options.skillPath) source.skillPath = options.skillPath;
      return source;
    }

    // ── Bundle source (legacy url path) ──
    return {
      type: 'bundle',
      baseUrl: input,
      installLayout: options.installLayout ?? 'flat',
    };
  }

  // ── Local path inputs ───────────────────────────────────────────────────────
  const dirPath = resolve(input);

  let stats;
  try {
    stats = await stat(dirPath);
  } catch {
    throw new Error(`Path does not exist: ${dirPath}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  return {
    type: 'bundle',
    dirPath,
    installLayout: options.installLayout ?? 'flat',
  };
}

// ── Source pin helpers ────────────────────────────────────────────────────────

/**
 * Build a SkillSourcePin from a resolved SkillSource.
 * The pin is what gets persisted in install records for reproducibility.
 *
 * @param source       The resolved SkillSource.
 * @param bundleVersion  Bundle version string (only used for bundle sources).
 */
export function buildSourcePin(
  source: SkillSource,
  bundleVersion?: string,
): SkillSourcePin {
  const base: SkillSourcePin = {
    sourceType: source.type,
    installLayout: source.installLayout,
  };

  if (source.type === 'repo') {
    return {
      ...base,
      repoUrl: source.repoUrl,
      ref: source.ref,
      skillPath: source.skillPath,
    };
  }

  if (source.type === 'artefact') {
    return {
      ...base,
      artefactUrl: source.artefactUrl,
      sha256: source.sha256,
    };
  }

  // bundle
  return {
    ...base,
    bundleVersion,
    ...(source.baseUrl ? { bundleBaseUrl: source.baseUrl } : {}),
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────
