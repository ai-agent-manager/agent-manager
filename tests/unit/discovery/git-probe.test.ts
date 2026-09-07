import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseGitRemoteInput,
  probeGitDiscovery,
  gitRemoteToRepoSource,
  isGithubRepoShorthand,
  type GitExecFile,
} from '../../../src/discovery/git-probe.js';
import { GIT_DISCOVERY_PATH } from '../../../src/discovery/fetcher.js';

describe('isGithubRepoShorthand', () => {
  it('accepts bare owner/repo forms', () => {
    expect(isGithubRepoShorthand('my-org/my-repo')).toBe(true);
    expect(isGithubRepoShorthand('my-org/my-repo.git')).toBe(true);
  });

  it('rejects URLs, relative paths, and deeper paths', () => {
    expect(isGithubRepoShorthand('https://github.com/org/repo')).toBe(false);
    expect(isGithubRepoShorthand('./org/repo')).toBe(false);
    expect(isGithubRepoShorthand('../org/repo')).toBe(false);
    expect(isGithubRepoShorthand('org/repo/extra')).toBe(false);
    expect(isGithubRepoShorthand('just-a-name')).toBe(false);
    expect(isGithubRepoShorthand('')).toBe(false);
  });
});

describe('parseGitRemoteInput', () => {
  it('expands owner/repo GitHub shorthand', () => {
    expect(parseGitRemoteInput('my-org/my-repo')).toEqual({
      cloneUrl: 'https://github.com/my-org/my-repo.git',
      identity: 'https://github.com/my-org/my-repo',
      refPinned: false,
      supportsDirectSkillInstall: true,
    });
  });

  it('strips a trailing .git from shorthand', () => {
    expect(parseGitRemoteInput('my-org/my-repo.git')).toEqual({
      cloneUrl: 'https://github.com/my-org/my-repo.git',
      identity: 'https://github.com/my-org/my-repo',
      refPinned: false,
      supportsDirectSkillInstall: true,
    });
  });

  it('uses the first configured GitHub host for shorthand', () => {
    expect(parseGitRemoteInput('my-org/my-repo', ['github.example.com', 'github.com'])).toEqual({
      cloneUrl: 'https://github.example.com/my-org/my-repo.git',
      identity: 'https://github.example.com/my-org/my-repo',
      refPinned: false,
      supportsDirectSkillInstall: true,
    });
  });

  it('recognises GitHub HTTPS repo URLs', () => {
    expect(parseGitRemoteInput('https://github.com/org/repo')).toEqual({
      cloneUrl: 'https://github.com/org/repo.git',
      identity: 'https://github.com/org/repo',
      refPinned: false,
      supportsDirectSkillInstall: true,
    });
  });

  it('pins a /tree/<ref> path', () => {
    expect(parseGitRemoteInput('https://github.com/org/repo/tree/v2.0')).toEqual({
      cloneUrl: 'https://github.com/org/repo.git',
      identity: 'https://github.com/org/repo',
      ref: 'v2.0',
      refPinned: true,
      supportsDirectSkillInstall: true,
    });
  });

  it('recognises *.git HTTPS remotes on any host', () => {
    expect(parseGitRemoteInput('https://gitlab.example.com/team/catalogue.git')).toEqual({
      cloneUrl: 'https://gitlab.example.com/team/catalogue.git',
      identity: 'https://gitlab.example.com/team/catalogue',
      refPinned: false,
      supportsDirectSkillInstall: false,
    });
  });

  it('recognises SCP-style git@ remotes', () => {
    expect(parseGitRemoteInput('git@github.com:org/repo.git')).toEqual({
      cloneUrl: 'git@github.com:org/repo.git',
      identity: 'https://github.com/org/repo',
      refPinned: false,
      supportsDirectSkillInstall: true,
    });
  });

  it('ignores plain HTTP discovery bases and zip artefacts', () => {
    expect(parseGitRemoteInput('https://skills.example.com')).toBeNull();
    expect(parseGitRemoteInput('https://cdn.example.com/agents/my-org/')).toBeNull();
    expect(parseGitRemoteInput('https://github.com/org/repo/releases/download/v1/skill.zip')).toBeNull();
  });
});

describe('gitRemoteToRepoSource', () => {
  it('builds a namespaced repo source from a git remote', () => {
    const remote = parseGitRemoteInput('https://github.com/org/repo/tree/release')!;
    expect(gitRemoteToRepoSource(remote)).toEqual({
      type: 'repo',
      repoUrl: 'https://github.com/org/repo',
      defaultBranch: 'main',
      ref: 'release',
      installLayout: 'namespaced',
    });
  });
});

describe('probeGitDiscovery', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'git-probe-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('returns null when the discovery file is absent after clone', async () => {
    const execFile: GitExecFile = async (_file, args) => {
      const dest = args[args.length - 1] as string;
      await mkdir(dest, { recursive: true });
      return { stdout: '', stderr: '' };
    };

    const remote = parseGitRemoteInput('https://github.com/org/skills-only')!;
    await expect(probeGitDiscovery(remote, { execFile, tempRoot })).resolves.toBeNull();
  });

  it('returns a validated discovery document when the file is present', async () => {
    const document = {
      version: '1',
      sources: [
        {
          name: 'catalogue',
          type: 'git',
          url: 'https://github.com/org/skills.git',
        },
      ],
    };

    const execFile: GitExecFile = async (_file, args) => {
      const dest = args[args.length - 1] as string;
      const discoveryPath = path.join(dest, GIT_DISCOVERY_PATH);
      await mkdir(path.dirname(discoveryPath), { recursive: true });
      await writeFile(discoveryPath, JSON.stringify(document));
      return { stdout: '', stderr: '' };
    };

    const remote = parseGitRemoteInput('https://github.com/org/catalogue')!;
    await expect(probeGitDiscovery(remote, { execFile, tempRoot })).resolves.toEqual(document);
  });

  it('throws when clone fails', async () => {
    const execFile: GitExecFile = async () => {
      throw new Error('fatal: repository not found');
    };

    const remote = parseGitRemoteInput('https://github.com/org/missing')!;
    await expect(probeGitDiscovery(remote, { execFile, tempRoot })).rejects.toThrow(
      /Failed to clone git remote/,
    );
  });

  it('throws when the discovery file is invalid JSON', async () => {
    const execFile: GitExecFile = async (_file, args) => {
      const dest = args[args.length - 1] as string;
      const discoveryPath = path.join(dest, GIT_DISCOVERY_PATH);
      await mkdir(path.dirname(discoveryPath), { recursive: true });
      await writeFile(discoveryPath, '{not-json');
      return { stdout: '', stderr: '' };
    };

    const remote = parseGitRemoteInput('https://github.com/org/broken')!;
    await expect(probeGitDiscovery(remote, { execFile, tempRoot })).rejects.toThrow(/not valid JSON/);
  });

  it('passes --branch only when the ref is pinned', async () => {
    const calls: string[][] = [];
    const execFile: GitExecFile = async (_file, args) => {
      calls.push([...args]);
      const dest = args[args.length - 1] as string;
      await mkdir(dest, { recursive: true });
      return { stdout: '', stderr: '' };
    };

    await probeGitDiscovery(parseGitRemoteInput('https://github.com/org/repo')!, {
      execFile,
      tempRoot,
    });
    expect(calls[0]).not.toContain('--branch');

    await probeGitDiscovery(parseGitRemoteInput('https://github.com/org/repo/tree/v1')!, {
      execFile,
      tempRoot,
    });
    expect(calls[1]).toEqual(
      expect.arrayContaining(['clone', '--depth', '1', '--branch', 'v1']),
    );
  });
});
