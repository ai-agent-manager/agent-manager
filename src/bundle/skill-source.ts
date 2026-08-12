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

import { createHash } from 'node:crypto';
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
  /**
   * Path prefix identifying one bundle stream among several hosted under the
   * same baseUrl (see DiscoverySource.basePath). Absent for the single-stream
   * legacy layout.
   */
  basePath?: string;
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
  /** Path prefix distinguishing this bundle stream from others on the same bundleBaseUrl. */
  bundleBasePath?: string;
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
    ...(source.basePath ? { bundleBasePath: source.basePath } : {}),
  };
}

/**
 * Build the source pin for a local-directory bundle install. Shared by the
 * headless and interactive install paths so a directory-sourced skill records
 * the same pin regardless of entry point. The pin carries no bundleBaseUrl, so
 * the update path can recognise it as a non-updatable local-directory install.
 */
export function buildPinForDirectorySource(dirPath: string, bundleVersion: string): SkillSourcePin {
  return buildSourcePin({ type: 'bundle', dirPath, installLayout: 'flat' }, bundleVersion);
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
 * Path segments that begin a web-UI route rather than repo identity.
 * GitHub/Gitea use /tree|blob|releases/…; GitLab nests all web routes under /-/.
 */
const REPO_ROUTE_MARKERS = new Set([
  '-', 'tree', 'blob', 'commit', 'commits', 'releases',
  'tags', 'archive', 'raw', 'src', 'browse', 'pull', 'pulls', 'issues',
]);

/**
 * Derive the install namespace for a repository URL.
 * Format: "<sanitised-host>/<sanitised-path-segments…>"
 *
 * The host is included so installs from GitHub Enterprise Server instances
 * never collide with github.com installs that share the same org/repo name.
 *
 * Every path segment is retained: on hosts that nest repositories (GitLab
 * subgroups, Gitea orgs, Azure DevOps) the segments past the second ARE the
 * repo identity, and dropping them made genuinely distinct repos share one
 * namespace — hence one link name — so the second install silently replaced
 * the first.
 *
 * Uses `host` rather than `hostname` so a non-default port stays distinct.
 * TODO: deriveArtefactNamespace still uses `hostname` and so drops the port —
 * align the two in a follow-up.
 *
 * Route markers are only honoured from position 2 on (see below). Residual edge:
 * a genuinely nested repo (GitLab subgroup) whose own name is a marker word, e.g.
 * a bare web URL group/sub/tree, is truncated to group/sub. Narrow, and clone URLs
 * (the discovery `git` source form) carry a .git suffix that dodges the marker set.
 */
export function deriveRepoNamespace(repoUrl: string): string {
  const parsed = new URL(repoUrl);
  let segments = parsed.pathname.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });

  // /org/repo/tree/<ref> identifies the same repo as /org/repo. Only look for a
  // route marker from position 2 on: the first two segments (org + repo) are always
  // identity, never a route, so a repo literally named a marker word — e.g.
  // chromium/src or chromium/tree — must not be truncated down to just its org.
  const marker = segments.findIndex((s, i) => i >= 2 && REPO_ROUTE_MARKERS.has(s.toLowerCase()));
  if (marker >= 2) segments = segments.slice(0, marker);

  // Only the final segment carries a .git clone suffix.
  if (segments.length > 0) {
    segments[segments.length - 1] = segments[segments.length - 1].replace(/\.git$/i, '');
  }

  return [parsed.host || parsed.hostname, ...(segments.length > 0 ? segments : ['unknown'])]
    .map(sanitiseNamespaceSegment)
    .join('/');
}

/**
 * Matches a GitHub release-asset download path: /<owner>/<repo>/releases/download/<tag>/<file>.
 * Host-agnostic on purpose, so it also recognises the same layout on GHES hosts.
 */
const GITHUB_RELEASE_ASSET_PATH = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/i;

/**
 * Derive the artefact name segment from a filename: strips the .zip extension and
 * any trailing semver-shaped version suffix, then sanitises to a safe segment.
 *
 * Version-suffix stripping is intentional: `app-2.0.0.zip` and `app.zip` map to
 * the same name so an upgrade overwrites the prior record. The rare false
 * positive is a distinct product whose filename ends in a semver-shaped token.
 *
 * Lowercased like every other namespace segment (see sanitiseNamespaceSegment):
 * without this, `MyApp.zip` and `myapp.zip` would derive distinct install keys
 * whose link paths still collide on case-insensitive filesystems (macOS, Windows)
 * while both config records survived — a silent partial collision.
 */
function deriveArtefactNameSegment(fileName: string): string {
  const base = fileName.toLowerCase().replace(/\.zip$/i, '');
  const suffixMatch = base.match(/^(.+?)[-_](v?\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/);
  const rawName = suffixMatch ? suffixMatch[1] : base;
  return rawName.replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'artefact';
}

/**
 * Derive the install namespace for an artefact URL.
 *
 * GitHub release-asset URLs (the explicitly supported artefact pattern) keep the
 * owner/repo path segments in the namespace: "<sanitised-host>/<owner>/<repo>/<artefact-name>".
 * Without this, two different owners publishing a release asset with the same
 * filename (e.g. "skills.zip") would derive the same namespace and silently
 * collide — the discarded path *is* the tenant identity on a multi-tenant host.
 *
 * All other artefact URLs fall back to "<sanitised-host>/<artefact-name>". Same-named
 * artefacts on the same host share a namespace — they represent the same logical
 * skill package across versions. See deriveArtefactNameSegment for the version-suffix
 * stripping rationale.
 */
export function deriveArtefactNamespace(artefactUrl: string): string {
  const parsed = new URL(artefactUrl);
  let host: string;
  try { host = decodeURIComponent(parsed.hostname); } catch { host = parsed.hostname; }
  const hostSegment = sanitiseNamespaceSegment(host);

  const releaseMatch = parsed.pathname.match(GITHUB_RELEASE_ASSET_PATH);
  if (releaseMatch) {
    const [, owner, repo, , fileName] = releaseMatch;
    return [
      hostSegment,
      sanitiseNamespaceSegment(owner),
      sanitiseNamespaceSegment(repo),
      deriveArtefactNameSegment(fileName),
    ].join('/');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] ?? '';
  return `${hostSegment}/${deriveArtefactNameSegment(fileName)}`;
}

/**
 * Derive the install namespace for a bundle (http) source: "<sanitised-host>[/<basePath-segments…>]".
 *
 * Only reached for `basePath`-qualified http sources — the single-stream
 * legacy bundle layout stays on installLayout 'flat' and never calls this
 * (see deriveInstallNamespace). Without the host+basePath split, two
 * basePath-qualified sources on different origins that happen to share a
 * basePath value would collide on install.
 */
export function deriveBundleNamespace(baseUrl: string, basePath?: string): string {
  const parsed = new URL(baseUrl);
  // `host` (not `hostname`) so a non-default port keeps two otherwise-identical
  // origins distinct — see the same rationale on deriveRepoNamespace above.
  let host: string;
  try { host = decodeURIComponent(parsed.host); } catch { host = parsed.host; }
  const hostSegment = sanitiseNamespaceSegment(host);

  if (!basePath) return hostSegment;

  // Percent-encode each raw segment before sanitising. sanitiseNamespaceSegment
  // collapses every run of non-alphanumeric characters to a single '-', so two
  // distinct basePath values differing only in punctuation (e.g. "team+a" vs
  // "team=a") would otherwise sanitise to the identical segment and collide on
  // install. Encoding first turns each distinguishing character into a distinct
  // hex pair that survives sanitisation intact.
  const segments = basePath
    .split('/')
    .filter(Boolean)
    .map((segment) => sanitiseNamespaceSegment(encodeURIComponent(segment)));
  return [hostSegment, ...segments].join('/');
}

/**
 * Derive the install namespace from a persisted SkillSourcePin.
 * Returns null for flat layouts (legacy single-stream bundle sources and any
 * source where installLayout is explicitly set to 'flat').
 */
export function deriveInstallNamespace(pin: SkillSourcePin): string | null {
  if (pin.installLayout !== 'namespaced') return null;
  if (pin.sourceType === 'repo' && pin.repoUrl) {
    return deriveRepoNamespace(pin.repoUrl);
  }
  if (pin.sourceType === 'artefact' && pin.artefactUrl) {
    return deriveArtefactNamespace(pin.artefactUrl);
  }
  if (pin.sourceType === 'bundle' && pin.bundleBaseUrl) {
    return deriveBundleNamespace(pin.bundleBaseUrl, pin.bundleBasePath);
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

/** Per-name filesystem limit is 255 bytes on APFS/ext4/NTFS — leave headroom. */
const MAX_LINK_NAME = 200;

/**
 * Build the on-disk link name for a namespaced install: "<flatNamespace>~<skillId>".
 *
 * Every boundary uses "~", which neither operand can contain (sanitiseNamespaceSegment
 * never emits it, and a skill dir name containing it is rejected at install time), so
 * the link name maps one-to-one onto the install key.
 *
 * Deeply nested sources can push that past the filesystem's per-name limit. In that
 * case the namespace prefix is truncated and a digest of the *full* namespace is
 * re-attached, so the shortened form stays one-to-one with the install key while the
 * readable prefix survives. Hashing only kicks in for the pathological case.
 *
 * Residual edge case: a skillDirName long enough to consume the whole budget on its own
 * leaves nothing to truncate, so the result can still exceed MAX_LINK_NAME. Not reachable
 * from a real scan — the dir name already exists on disk and so is itself under the
 * filesystem limit — but the guarantee is best-effort rather than absolute.
 */
export function buildLinkName(namespace: string, skillDirName: string): string {
  const flat = flattenNamespace(namespace);
  const full = `${flat}~${skillDirName}`;
  if (full.length <= MAX_LINK_NAME) return full;

  const digest = createHash('sha256').update(namespace).digest('hex').slice(0, 10);
  const budget = Math.max(MAX_LINK_NAME - skillDirName.length - digest.length - 2, 0);
  return `${flat.slice(0, budget)}-${digest}~${skillDirName}`;
}
