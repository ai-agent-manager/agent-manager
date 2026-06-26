import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tempBase: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAgentmanDir: () => tempBase,
}));

// Shared state for controlling mock behavior
let gitMode: 'none' | 'clone-fail' | 'push-fail' | 'config-fail' | 'checkout-fail' | 'commit-fail' | 'push-other-fail' = 'none';
let gitFilesAdded = false;
let skipStatus = false;
let mockWhichGh: string | null = '/usr/local/bin/gh';
let mockGhPr: { stdout: string; stderr: string } | null = { stdout: 'https://github.com/org/repo/pull/42\n', stderr: '' };
let mockGhPrErr: Error | null = null;

vi.mock('node:util', () => ({
  promisify: (fn: Function) => {
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        const lastArg = args[args.length - 1];
        if (typeof lastArg === 'function') {
          args[args.length - 1] = (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          };
          fn(...args);
        } else {
          const cmd = args[0] as string;
          const argv = args[1] as string[];

          // Git commands
          if (cmd === 'git' && argv[0] === 'clone' && gitMode === 'clone-fail') {
            reject(new Error('fatal: repository not found'));
            return;
          }
          if (cmd === 'git' && argv[0] === 'checkout' && gitMode === 'checkout-fail') {
            reject(new Error('fatal: branch creation failed'));
            return;
          }
          if (cmd === 'git' && argv[0] === 'config' && gitMode === 'config-fail') {
            reject(new Error('not found'));
            return;
          }
          if (cmd === 'git' && argv[0] === 'add') {
            gitFilesAdded = true;
            resolve({ stdout: '', stderr: '' });
            return;
          }
          if (cmd === 'git' && argv[0] === 'status' && argv[1] === '--porcelain') {
            if (skipStatus) {
              resolve({ stdout: '', stderr: '' });
              return;
            }
            if (gitFilesAdded) {
              resolve({ stdout: 'A skills/test-skill/SKILL.md\n', stderr: '' });
              return;
            }
            resolve({ stdout: '', stderr: '' });
            return;
          }
          if (cmd === 'git' && argv[0] === 'commit' && gitMode === 'commit-fail') {
            reject(new Error('commit failed'));
            return;
          }
          if (cmd === 'git' && argv[0] === 'push' && gitMode === 'push-fail') {
            reject(new Error('fatal: Authentication failed (403)'));
            return;
          }
          if (cmd === 'git' && argv[0] === 'push' && gitMode === 'push-other-fail') {
            reject(new Error('remote: Permission denied'));
            return;
          }
          if (cmd === 'git') {
            resolve({ stdout: '', stderr: '' });
            return;
          }

          // PR/gh commands
          if (cmd === 'which' && argv[0] === 'gh') {
            if (mockWhichGh) {
              resolve({ stdout: mockWhichGh + '\n', stderr: '' });
            } else {
              reject(new Error('not found'));
            }
            return;
          }
          if (cmd === 'gh' && argv[0] === 'pr') {
            if (mockGhPrErr) {
              reject(mockGhPrErr);
            } else {
              resolve(mockGhPr!);
            }
            return;
          }

          reject(new Error(`unexpected command: ${cmd}`));
        }
      });
    };
  },
}));

const { contributeToRepo } = await import('../../../src/contribute/git.js');
const { isGithubRepo, isGhAvailable, createDraftPr } = await import('../../../src/contribute/pr.js');

describe('isGithubRepo', () => {
  it('detects https github URLs', () => {
    expect(isGithubRepo('https://github.com/org/repo.git')).toBe(true);
  });
  it('detects git@github.com URLs', () => {
    expect(isGithubRepo('git@github.com:org/repo.git')).toBe(true);
  });
  it('detects github.com without .git', () => {
    expect(isGithubRepo('https://github.com/org/repo')).toBe(true);
  });
  it('rejects non-github URLs', () => {
    expect(isGithubRepo('https://gitlab.com/org/repo.git')).toBe(false);
  });
  it('rejects bitbucket URLs', () => {
    expect(isGithubRepo('https://bitbucket.org/org/repo.git')).toBe(false);
  });
  it('rejects self-hosted git', () => {
    expect(isGithubRepo('https://git.company.com/org/repo.git')).toBe(false);
  });
});

describe('isGhAvailable', () => {
  beforeEach(() => {
    mockWhichGh = '/usr/local/bin/gh';
  });
  it('returns true when gh is available', async () => {
    expect(await isGhAvailable()).toBe(true);
  });
  it('returns false when gh is not available', async () => {
    mockWhichGh = null;
    expect(await isGhAvailable()).toBe(false);
  });
});

describe('createDraftPr', () => {
  beforeEach(() => {
    mockWhichGh = '/usr/local/bin/gh';
    mockGhPr = { stdout: 'https://github.com/org/repo/pull/42\n', stderr: '' };
    mockGhPrErr = null;
  });
  it('returns not-github reason when gh is not installed', async () => {
    mockWhichGh = null;
    const result = await createDraftPr('https://github.com/org/repo.git', 'contribute/test/abc123', 'Test Skill', 'A test skill');
    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('gh-not-installed');
  });
  it('creates a PR and extracts URL when gh succeeds', async () => {
    const result = await createDraftPr('https://github.com/org/repo.git', 'contribute/test/abc123', 'Test Skill', 'A test skill');
    expect(result.created).toBe(true);
    if (result.created) expect(result.prUrl).toBe('https://github.com/org/repo/pull/42');
  });
  it('returns gh-not-installed reason when gh pr create fails', async () => {
    mockGhPrErr = new Error('gh: command not found');
    const result = await createDraftPr('https://github.com/org/repo.git', 'contribute/test/abc123', 'Test Skill', 'A test skill');
    expect(result.created).toBe(false);
    if (!result.created) expect(result.reason).toBe('gh-not-installed');
  });
});

describe('contributeToRepo', () => {
  let tempDir: string;
  let skillDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `git-contribute-test-${Date.now()}`);
    tempBase = tempDir;
    skillDir = path.join(tempDir, 'skill-source');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill
---

Content`,
    );
    gitMode = 'none';
    gitFilesAdded = false;
    skipStatus = false;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('clones, creates branch, copies skill, and pushes', async () => {
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');

    expect(result).toBeDefined();
    if ('error' in result) {
      throw new Error(`Expected GitContributeResult, got: ${result.error}`);
    }
    expect(result.skillName).toBe('test-skill');
    expect(result.branchName).toMatch(/^contribute\/test-skill\//);
    expect(result.targetPath).toBe('skills/test-skill');
  });

  it('returns error when clone fails', async () => {
    gitMode = 'clone-fail';
    const result = await contributeToRepo('https://github.com/nonexistent/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('Failed to clone repository');
  });

  it('returns auth error hint on authentication failure', async () => {
    gitMode = 'push-fail';
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('authentication required');
  });

  it('warns when git user config is missing but still works', async () => {
    gitMode = 'config-fail';
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect(result).toBeDefined();
    if ('error' in result) throw new Error(`Expected success, got: ${result.error}`);
  });

  it('returns error when branch creation fails', async () => {
    gitMode = 'checkout-fail';
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('Failed to create branch');
  });

  it('returns error when skill already exists (empty status)', async () => {
    skipStatus = true;
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('No changes to commit');
  });

  it('returns error when commit fails', async () => {
    gitMode = 'commit-fail';
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('Failed to commit changes');
  });

  it('returns non-auth error on non-auth push failure', async () => {
    gitMode = 'push-other-fail';
    const result = await contributeToRepo('https://github.com/example/repo.git', skillDir, 'test-skill');
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toContain('Failed to push branch');
    if ('error' in result) expect(result.error).not.toContain('authentication required');
  });
});

describe('contribute (orchestration)', () => {
  let tempDir: string;
  let skillDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `contribute-orch-test-${Date.now()}`);
    tempBase = tempDir;
    skillDir = path.join(tempDir, 'skill-source');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill
---

Content`,
    );
    gitMode = 'none';
    gitFilesAdded = false;
    skipStatus = false;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns early when validation fails', async () => {
    const { contribute } = await import('../../../src/contribute/index.js');
    const result = await contribute('/nonexistent/path', 'https://github.com/example/repo.git');
    expect(result.validated.valid).toBe(false);
    expect(result.gitResult).toHaveProperty('error');
    expect(result.prOutcome).toBeNull();
  });

  it('returns early when git operation fails', async () => {
    const { contribute } = await import('../../../src/contribute/index.js');
    gitMode = 'clone-fail';
    const result = await contribute(skillDir, 'https://github.com/example/repo.git');
    expect(result.validated.valid).toBe(true);
    expect(result.gitResult).toHaveProperty('error');
    expect(result.prOutcome).toBeNull();
  });

  it('skips PR for non-github repos', async () => {
    const { contribute } = await import('../../../src/contribute/index.js');
    const result = await contribute(skillDir, 'https://gitlab.com/example/repo.git');
    expect(result.validated.valid).toBe(true);
    if ('error' in result.gitResult) throw new Error(`Expected success, got: ${result.gitResult.error}`);
    expect(result.prOutcome).toBeNull();
  });
});
