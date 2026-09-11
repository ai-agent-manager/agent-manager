import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseGitRemoteInput,
  probeGitDiscovery,
  gitRemoteToRepoSource,
  isGithubRepoShorthand,
  buildGithubDiscoveryContentsUrl,
  type GitExecFile,
  type GitProbeFetch,
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

describe('buildGithubDiscoveryContentsUrl', () => {
  it('uses api.github.com for github.com and omits ref when unpinned', () => {
    const remote = parseGitRemoteInput('https://github.com/org/repo')!;
    expect(buildGithubDiscoveryContentsUrl(remote)).toBe(
      'https://api.github.com/repos/org/repo/contents/.agents/discovery.json',
    );
  });

  it('adds the pinned ref as a query parameter', () => {
    const remote = parseGitRemoteInput('https://github.com/org/repo/tree/abc123')!;
    expect(buildGithubDiscoveryContentsUrl(remote)).toBe(
      'https://api.github.com/repos/org/repo/contents/.agents/discovery.json?ref=abc123',
    );
  });

  it('uses the GHES /api/v3 prefix for enterprise hosts', () => {
    const remote = parseGitRemoteInput('https://github.example.com/org/repo', [
      'github.example.com',
    ])!;
    expect(buildGithubDiscoveryContentsUrl(remote)).toBe(
      'https://github.example.com/api/v3/repos/org/repo/contents/.agents/discovery.json',
    );
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
  const previousToken = process.env['GITHUB_TOKEN'];

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'git-probe-test-'));
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    if (previousToken === undefined) {
      delete process.env['GITHUB_TOKEN'];
    } else {
      process.env['GITHUB_TOKEN'] = previousToken;
    }
  });

  function jsonResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
    return new Response(body, { status, headers });
  }

  describe('GitHub Contents API path', () => {
    it('returns null on HTTP 404 without calling git', async () => {
      const execFile = vi.fn<GitExecFile>();
      const fetchImpl: GitProbeFetch = async () => jsonResponse(404, 'Not Found');

      const remote = parseGitRemoteInput('https://github.com/org/skills-only')!;
      await expect(
        probeGitDiscovery(remote, { execFile, fetch: fetchImpl, tempRoot }),
      ).resolves.toBeNull();
      expect(execFile).not.toHaveBeenCalled();
    });

    it('returns a validated discovery document from the raw Contents response', async () => {
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
      const fetchImpl: GitProbeFetch = async () =>
        jsonResponse(200, JSON.stringify(document));

      const remote = parseGitRemoteInput('https://github.com/org/catalogue')!;
      await expect(
        probeGitDiscovery(remote, { fetch: fetchImpl, tempRoot }),
      ).resolves.toEqual(document);
    });

    it('sends Authorization: token when GITHUB_TOKEN is set, never in the URL', async () => {
      const calls: { url: string; headers?: Record<string, string> }[] = [];
      const fetchImpl: GitProbeFetch = async (url, init) => {
        calls.push({ url, headers: init?.headers });
        return jsonResponse(404, '');
      };

      const remote = parseGitRemoteInput('https://github.com/org/private')!;
      await probeGitDiscovery(remote, {
        token: 'ghp_test_token_value',
        fetch: fetchImpl,
        tempRoot,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).not.toContain('ghp_');
      expect(calls[0].url).not.toContain('test_token');
      expect(calls[0].headers?.Authorization).toBe('token ghp_test_token_value');
      expect(calls[0].headers?.Accept).toBe('application/vnd.github.raw');
      expect(calls[0].headers?.['User-Agent']).toBe('agentman');
    });

    it('reads GITHUB_TOKEN from the environment when options.token is omitted', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_from_env';
      const calls: { headers?: Record<string, string> }[] = [];
      const fetchImpl: GitProbeFetch = async (_url, init) => {
        calls.push({ headers: init?.headers });
        return jsonResponse(404, '');
      };

      await probeGitDiscovery(parseGitRemoteInput('org/repo')!, {
        fetch: fetchImpl,
        tempRoot,
      });

      expect(calls[0].headers?.Authorization).toBe('token ghp_from_env');
    });

    it('throws on HTTP 401/403 instead of treating them as a miss', async () => {
      const fetchImpl: GitProbeFetch = async () => jsonResponse(401, 'Bad credentials');

      await expect(
        probeGitDiscovery(parseGitRemoteInput('https://github.com/org/private')!, {
          token: 'bad',
          fetch: fetchImpl,
          tempRoot,
        }),
      ).rejects.toThrow(/HTTP 401/);
    });

    it('throws when the discovery file is invalid JSON', async () => {
      const fetchImpl: GitProbeFetch = async () => jsonResponse(200, '{not-json');

      await expect(
        probeGitDiscovery(parseGitRemoteInput('https://github.com/org/broken')!, {
          fetch: fetchImpl,
          tempRoot,
        }),
      ).rejects.toThrow(/not valid JSON/);
    });

    it('passes a commit SHA pin as the Contents API ref query', async () => {
      const sha = '0123456789abcdef0123456789abcdef01234567';
      const calls: string[] = [];
      const fetchImpl: GitProbeFetch = async (url) => {
        calls.push(url);
        return jsonResponse(404, '');
      };

      await probeGitDiscovery(
        parseGitRemoteInput(`https://github.com/org/repo/tree/${sha}`)!,
        { fetch: fetchImpl, tempRoot },
      );

      expect(calls[0]).toContain(`ref=${sha}`);
    });
  });

  describe('non-GitHub git clone path', () => {
    it('returns null when the discovery file is absent after clone', async () => {
      const execFile: GitExecFile = async (_file, args) => {
        const dest = args[args.length - 1] as string;
        await mkdir(dest, { recursive: true });
        return { stdout: '', stderr: '' };
      };

      const remote = parseGitRemoteInput('https://bitbucket.example.com/team/skills.git')!;
      await expect(probeGitDiscovery(remote, { execFile, tempRoot })).resolves.toBeNull();
    });

    it('returns a validated discovery document when the file is present', async () => {
      const document = {
        version: '1',
        sources: [
          {
            name: 'catalogue',
            type: 'git',
            url: 'https://bitbucket.example.com/team/skills.git',
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

      const remote = parseGitRemoteInput('https://bitbucket.example.com/team/catalogue.git')!;
      await expect(probeGitDiscovery(remote, { execFile, tempRoot })).resolves.toEqual(document);
    });

    it('throws when clone fails and includes stderr', async () => {
      const execFile: GitExecFile = async () => {
        const err = new Error('Command failed') as Error & { stderr: string };
        err.stderr = 'fatal: repository not found\n';
        throw err;
      };

      const remote = parseGitRemoteInput('https://bitbucket.example.com/team/missing.git')!;
      await expect(probeGitDiscovery(remote, { execFile, tempRoot })).rejects.toThrow(
        /Failed to clone git remote[\s\S]*fatal: repository not found/,
      );
    });

    it('passes --quiet and GIT_TERMINAL_PROMPT=0, and --branch only when pinned', async () => {
      const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
      const execFile: GitExecFile = async (_file, args, options) => {
        calls.push({ args: [...args], env: options?.env });
        const dest = args[args.length - 1] as string;
        await mkdir(dest, { recursive: true });
        return { stdout: '', stderr: '' };
      };

      await probeGitDiscovery(
        parseGitRemoteInput('https://bitbucket.example.com/team/repo.git')!,
        { execFile, tempRoot },
      );
      expect(calls[0].args).toEqual(
        expect.arrayContaining(['clone', '--depth', '1', '--quiet']),
      );
      expect(calls[0].args).not.toContain('--branch');
      expect(calls[0].env?.GIT_TERMINAL_PROMPT).toBe('0');

      await probeGitDiscovery(
        {
          cloneUrl: 'https://bitbucket.example.com/team/repo.git',
          identity: 'https://bitbucket.example.com/team/repo',
          ref: 'v1',
          refPinned: true,
          supportsDirectSkillInstall: false,
        },
        { execFile, tempRoot },
      );
      expect(calls[1].args).toEqual(
        expect.arrayContaining(['clone', '--depth', '1', '--quiet', '--branch', 'v1']),
      );
    });

    it('does not put a token into git argv when GITHUB_TOKEN is set', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_should_not_appear_in_git';
      const calls: string[][] = [];
      const execFile: GitExecFile = async (_file, args) => {
        calls.push([...args]);
        const dest = args[args.length - 1] as string;
        await mkdir(dest, { recursive: true });
        return { stdout: '', stderr: '' };
      };

      await probeGitDiscovery(
        parseGitRemoteInput('https://bitbucket.example.com/team/repo.git')!,
        { execFile, tempRoot },
      );

      const flat = calls.flat().join(' ');
      expect(flat).not.toContain('ghp_');
      expect(flat).not.toContain('should_not_appear');
    });
  });
});
