/**
 * SHIM: Temporary git source support for the CLI.
 *
 * This file wires the git skill importer into the CLI so users can run:
 *
 *   agentman <git-url>
 *   agentman <any-url> --type=git
 *
 * It should be removed and superseded by the discovery mechanism
 * in PR #16 and PR #14.
 */
import type { BundleManifest } from '../bundle/manifest.js';
import type { BundleContents } from '../bundle/scanner.js';
import type { TelemetryValue } from '../telemetry.js';
import { importGitSkills } from './git-importer.js';

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the input looks like a git repository URL, or the user
 * explicitly passed --type=git.
 */
export function isGitSource(input: string, typeHint?: string): boolean {
  if (typeHint === 'git') return true;
  return /^git:\/\//i.test(input) || /^git@/i.test(input) || /\.git$/i.test(input);
}

/**
 * Build a git BundleSource value from the raw input string.
 */
export function resolveGitSource(input: string) {
  return { type: 'git' as const, repoUrl: input };
}

// ---------------------------------------------------------------------------
// Bundle acquisition
// ---------------------------------------------------------------------------

export interface GitBundleResult {
  manifest: BundleManifest;
  bundleContents: BundleContents;
  bundleDir: string;
  warning?: string;
}

/**
 * Clone the git repo, scan for skills, and return everything the App
 * component needs to populate its state — without touching the normal
 * bundle cache or version management.
 */
export async function acquireGitBundle(repoUrl: string): Promise<GitBundleResult> {
  const repoName = deriveRepoName(repoUrl);
  const result = await importGitSkills(repoUrl, repoName);

  const manifest: BundleManifest = {
    version: `git-${repoName}`,
    published: new Date().toISOString(),
  };

  const bundleContents: BundleContents = {
    skills: result.skills,
    rovoAgents: [],
  };

  const warning =
    result.skills.length === 0
      ? `No skills found in ${repoUrl}. Expected skills/<name>/SKILL.md or a root SKILL.md.`
      : undefined;

  return { manifest, bundleContents, bundleDir: result.clonePath, warning };
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

const GIT_BUNDLE_ENDPOINT = 'git-repo';

export function gitSourceTelemetryProperties(): Record<string, TelemetryValue> {
  return {
    source: 'git',
    bundleEndpoint: GIT_BUNDLE_ENDPOINT,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a short, stable cache name from a git URL.
 *
 * Examples:
 *   https://github.com/org/repo.git  → repo
 *   git@github.com:org/repo.git      → repo
 *   file:///tmp/test-plugin           → test-plugin
 */
function deriveRepoName(repoUrl: string): string {
  return (
    repoUrl
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .filter(Boolean)
      .pop() ?? 'git-repo'
  );
}
