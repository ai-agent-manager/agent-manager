import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GITHUB_HOSTS_DEFAULT,
  isGithubRepoUrl,
  type RepoSkillSource,
} from '../bundle/skill-source.js';
import {
  DiscoveryError,
  GIT_DISCOVERY_PATH,
  parseDiscoveryDocument,
} from './fetcher.js';
import type { DiscoveryDocument } from './types.js';

const defaultExecFile = promisify(execFile);

const CLONE_TIMEOUT_MS = 60_000;

export type GitExecFile = (
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface GitRemoteRef {
  /** URL passed to `git clone`. */
  cloneUrl: string;
  /**
   * Identity stored as discovery `baseUrl` / persisted source value.
   * HTTPS `origin/org/repo` when that can be derived; otherwise the raw input.
   */
  identity: string;
  /** Explicit ref from `/tree/<ref>`; omitted when unset. */
  ref?: string;
  /** True when the user pinned a ref (do not rely on remote HEAD). */
  refPinned: boolean;
  /** True when a miss can fall back to GitHub archive skill install. */
  supportsDirectSkillInstall: boolean;
}

export interface ProbeGitDiscoveryOptions {
  /** Override `git` execution (tests). */
  execFile?: GitExecFile;
  /** Override temp directory root (tests). */
  tempRoot?: string;
}

/**
 * `owner/repo` GitHub shorthand — exactly two path segments of GitHub-safe
 * characters. Callers must prefer an existing local directory over this form.
 */
const GITHUB_SHORTHAND = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/**
 * True when the input is bare `owner/repo` shorthand (not a URL or path with
 * `./` / `../`). Does not check the filesystem.
 */
export function isGithubRepoShorthand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('.') || trimmed.includes('\\')) return false;
  return GITHUB_SHORTHAND.test(trimmed);
}

/**
 * Detect whether a startup input should be probed as a git remote for a
 * discovery document before any other resolution path.
 *
 * Matches:
 * - `owner/repo` (GitHub shorthand → first configured GitHub host)
 * - `git@host:path/repo(.git)`
 * - `ssh://git@host/path/repo(.git)`
 * - `http(s)://…/repo.git`
 * - GitHub / configured GHES repo URLs (with or without `.git`)
 */
export function parseGitRemoteInput(
  input: string,
  githubHosts: readonly string[] = GITHUB_HOSTS_DEFAULT,
): GitRemoteRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (isGithubRepoShorthand(trimmed)) {
    const match = trimmed.match(GITHUB_SHORTHAND)!;
    const org = match[1];
    const repo = match[2].replace(/\.git$/i, '');
    const host = githubHosts[0] ?? 'github.com';
    return {
      cloneUrl: `https://${host}/${org}/${repo}.git`,
      identity: `https://${host}/${org}/${repo}`,
      refPinned: false,
      supportsDirectSkillInstall: true,
    };
  }

  const scp = trimmed.match(/^git@([^:]+):(.+)$/i);
  if (scp) {
    const host = scp[1];
    const repoPath = scp[2].replace(/\/+$/, '').replace(/\.git$/i, '');
    const supportsDirectSkillInstall = githubHosts.includes(host.toLowerCase());
    return {
      cloneUrl: trimmed,
      identity: supportsDirectSkillInstall
        ? `https://${host}/${repoPath}`
        : trimmed,
      refPinned: false,
      supportsDirectSkillInstall,
    };
  }

  if (/^ssh:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname;
      const repoPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
      const supportsDirectSkillInstall = githubHosts.includes(host.toLowerCase());
      return {
        cloneUrl: trimmed,
        identity: supportsDirectSkillInstall
          ? `https://${host}/${repoPath}`
          : trimmed,
        refPinned: false,
        supportsDirectSkillInstall,
      };
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.pathname.toLowerCase().endsWith('.zip')) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const endsWithGit = segments.length > 0 && /\.git$/i.test(segments[segments.length - 1]);
  const isGithub = isGithubRepoUrl(trimmed, githubHosts);

  if (!endsWithGit && !isGithub) {
    return null;
  }

  if (segments.length < 2) {
    return null;
  }

  const [org, repoSegment, treeSegment, refFromPath] = segments;
  const repo = repoSegment.replace(/\.git$/i, '');
  const refPinned = treeSegment === 'tree' && Boolean(refFromPath);
  const identity = `${parsed.origin}/${org}/${repo}`;
  const cloneUrl = `${parsed.origin}/${org}/${repo}.git`;

  return {
    cloneUrl,
    identity,
    ...(refPinned ? { ref: refFromPath } : {}),
    refPinned,
    supportsDirectSkillInstall: isGithub,
  };
}

/**
 * Build a RepoSkillSource for a git remote that supports direct GitHub skill install.
 */
export function gitRemoteToRepoSource(
  remote: GitRemoteRef,
  installLayout: 'namespaced' | 'flat' = 'namespaced',
): RepoSkillSource {
  const defaultBranch = 'main';
  const ref = remote.refPinned && remote.ref ? remote.ref : defaultBranch;
  return {
    type: 'repo',
    repoUrl: remote.identity,
    defaultBranch,
    ref,
    installLayout,
  };
}

/**
 * Shallow-clone a git remote and look for `.well-known/agents/discovery.json`.
 *
 * Returns the validated document when present, or `null` when the file is
 * absent (caller falls back to bare skills-repo install when supported).
 *
 * Clone / auth / invalid-JSON failures throw — they are not treated as a miss.
 */
export async function probeGitDiscovery(
  remote: GitRemoteRef,
  options: ProbeGitDiscoveryOptions = {},
): Promise<DiscoveryDocument | null> {
  const runGit = options.execFile ?? defaultExecFile;
  const tempRoot = options.tempRoot ?? tmpdir();
  const tmp = await mkdtemp(path.join(tempRoot, 'agentman-git-probe-'));

  try {
    const args = ['clone', '--depth', '1'];
    if (remote.refPinned && remote.ref) {
      args.push('--branch', remote.ref);
    }
    args.push('--', remote.cloneUrl, tmp);

    try {
      await runGit('git', args, { timeout: CLONE_TIMEOUT_MS });
    } catch (err) {
      throw new DiscoveryError(
        `Failed to clone git remote for discovery probe: ${remote.cloneUrl}`,
        remote.identity,
        err,
      );
    }

    const discoveryPath = path.join(tmp, GIT_DISCOVERY_PATH);
    if (!(await fileExists(discoveryPath))) {
      return null;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readFile(discoveryPath, 'utf-8'));
    } catch (err) {
      throw new DiscoveryError(
        `Discovery document at ${GIT_DISCOVERY_PATH} in ${remote.identity} is not valid JSON`,
        remote.identity,
        err,
      );
    }

    return parseDiscoveryDocument(body, remote.identity);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}
