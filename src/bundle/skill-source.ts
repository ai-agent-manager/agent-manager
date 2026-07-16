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
  /**
   * Resolved artefact version. Derived from the URL, the embedded
   * manifest.json, or the content hash — populated by the artefact
   * downloader after acquisition.
   */
  version?: string;
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
  /** Resolved artefact version pinned at install time. */
  artefactVersion?: string;
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

/** Hosts considered loopback for the artefact https requirement. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
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
      if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
        throw new Error(
          `Artefact sources must use https: ${input}\n` +
          `  Plain http is only allowed for localhost during development.`,
        );
      }
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
      artefactVersion: source.version,
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

/**
 * Return a human-readable description of a SkillSource for use in CLI output.
 */
export function describeSkillSource(source: SkillSource): string {
  if (source.type === 'repo') {
    const ref = source.ref ?? source.defaultBranch ?? 'main';
    const skillSegment = source.skillPath ? ` (${source.skillPath})` : '';
    return `repo: ${source.repoUrl}@${ref}${skillSegment}`;
  }
  if (source.type === 'artefact') {
    return `artefact: ${source.artefactUrl}`;
  }
  return source.baseUrl
    ? `bundle: ${source.baseUrl}`
    : `bundle: ${source.dirPath ?? '(local)'}`;
}

// ── Namespace derivation ──────────────────────────────────────────────────────

/**
 * Sanitise a single namespace path segment for safe use as a filesystem directory name.
 * Lowercases, replaces any character outside [a-z0-9._-] with '-', and strips
 * leading/trailing hyphens. Returns 'unknown' for empty inputs.
 */
export function sanitiseNamespaceSegment(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-]+|[-]+$/g, '');
  return cleaned || 'unknown';
}

/**
 * Derive the install namespace for a GitHub repository URL.
 * Format: "<sanitised-host>/<sanitised-org>/<sanitised-repo>"
 *
 * The host is included so installs from GitHub Enterprise Server instances
 * never collide with github.com installs that share the same org/repo name.
 */
export function deriveRepoNamespace(repoUrl: string): string {
  const parsed = new URL(repoUrl);
  const segments = parsed.pathname.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  const org = segments[0] ?? 'unknown';
  const repo = segments[1]?.replace(/\.git$/i, '') ?? 'unknown';
  return [
    sanitiseNamespaceSegment(parsed.hostname),
    sanitiseNamespaceSegment(org),
    sanitiseNamespaceSegment(repo),
  ].join('/');
}

/**
 * Derive the install namespace for an artefact URL.
 * Format: "<sanitised-host>/<artefact-name>"
 *
 * The artefact name is taken from the filename (without version suffix or .zip
 * extension). Same-named artefacts on the same host share a namespace — they
 * represent the same logical skill package across versions.
 *
 * Version-suffix stripping is intentional: `app-2.0.0.zip` and `app.zip` map to
 * the same namespace so an upgrade overwrites the prior record. The rare false
 * positive is a distinct product whose filename ends in a semver-shaped token.
 */
export function deriveArtefactNamespace(artefactUrl: string): string {
  const parsed = new URL(artefactUrl);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? '';
  const base = fileName.replace(/\.zip$/i, '');

  const suffixMatch = base.match(/^(.+?)[-_](v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/);
  const rawName = suffixMatch ? suffixMatch[1] : base;
  const name = rawName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'artefact';

  let host: string;
  try { host = decodeURIComponent(parsed.hostname); } catch { host = parsed.hostname; }
  return `${sanitiseNamespaceSegment(host)}/${name}`;
}

/**
 * Derive the install namespace from a persisted SkillSourcePin.
 * Returns null for flat layouts (bundle sources and any source where
 * installLayout is explicitly set to 'flat').
 */
export function deriveInstallNamespace(pin: SkillSourcePin): string | null {
  if (pin.installLayout !== 'namespaced') return null;
  if (pin.sourceType === 'repo' && pin.repoUrl) {
    return deriveRepoNamespace(pin.repoUrl);
  }
  if (pin.sourceType === 'artefact' && pin.artefactUrl) {
    return deriveArtefactNamespace(pin.artefactUrl);
  }
  return null;
}

/**
 * Build the install config key for a skill.
 * When namespace is non-null: "<namespace>/<skillDirName>"  (namespaced layout)
 * When namespace is null:      "<skillDirName>"             (flat layout)
 */
export function buildInstallKey(namespace: string | null, skillDirName: string): string {
  return namespace ? `${namespace}/${skillDirName}` : skillDirName;
}

/**
 * Resolve a scanned skill to its install identity: "<namespace>/<skillId>" for
 * namespaced sources, bare "<skillId>" for flat/bundle sources.
 */
export function deriveSkillInstallKey(skill: { sourcePin?: SkillSourcePin; dirName: string }): string {
  return buildInstallKey(skill.sourcePin ? deriveInstallNamespace(skill.sourcePin) : null, skill.dirName);
}

/**
 * Flatten a namespace string into a safe single-segment filesystem token.
 *
 * Injectivity: split on "/" into segments, join with "~". sanitiseNamespaceSegment
 * only ever emits characters from [a-z0-9._-], so "~" can never appear inside a
 * segment — every "~" in the output is unambiguously a segment boundary, and the
 * flat token maps one-to-one onto the structured namespace. "~" is legal on
 * Windows/NTFS (the reserved set is `< > : " / \ | ? *`).
 *
 * Example: "github.com/acme/data-pipeline"  → "github.com~acme~data-pipeline"
 *          "github.com/acme-data/pipeline"  → "github.com~acme-data~pipeline"
 */
export function flattenNamespace(namespace: string): string {
  return namespace.split('/').join('~');
}
