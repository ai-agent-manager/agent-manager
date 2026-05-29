import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// Mock node:fs/promises
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    stat: vi.fn(),
  };
});

import { findRepoRoot, isInsideRepo, getRepoName } from '../../../src/lib/repo.js';
import { stat } from 'node:fs/promises';

const mockStat = vi.mocked(stat);

// Use path.resolve to get platform-correct absolute paths for test fixtures.
// path.join with POSIX-style paths produces inconsistent results on Windows.
const REPO_ROOT = path.resolve('home', 'user', 'projects', 'my-repo');
const WORKTREE_ROOT = path.resolve('home', 'user', 'worktree');
const STRANGE_ROOT = path.resolve('home', 'user', 'strange');
const MY_REPO = path.resolve('my-repo');

describe('findRepoRoot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the directory containing .git when found', async () => {
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(REPO_ROOT, '.git')) {
        return { isDirectory: () => true, isFile: () => false } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    const root = await findRepoRoot(path.join(REPO_ROOT, 'src', 'lib'));
    expect(root).toBe(REPO_ROOT);
  });

  it('returns null when no .git directory is found up to filesystem root', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const root = await findRepoRoot(path.resolve('home', 'user', 'no-repo', 'deep', 'path'));
    expect(root).toBeNull();
  });

  it('returns the immediate directory if .git is there', async () => {
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(MY_REPO, '.git')) {
        return { isDirectory: () => true, isFile: () => false } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    const root = await findRepoRoot(MY_REPO);
    expect(root).toBe(MY_REPO);
  });

  it('finds repo root when .git is a file (worktree)', async () => {
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(WORKTREE_ROOT, '.git')) {
        // In a git worktree, .git is a file (not a directory)
        return { isDirectory: () => false, isFile: () => true } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    const root = await findRepoRoot(path.join(WORKTREE_ROOT, 'src'));
    expect(root).toBe(WORKTREE_ROOT);
  });

  it('returns null when .git entry is neither a file nor a directory', async () => {
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(STRANGE_ROOT, '.git')) {
        return { isDirectory: () => false, isFile: () => false } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    const root = await findRepoRoot(STRANGE_ROOT);
    expect(root).toBeNull();
  });
});

describe('isInsideRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when inside a repo', async () => {
    const repoRoot = path.resolve('repo');
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(repoRoot, '.git')) {
        return { isDirectory: () => true, isFile: () => false } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    expect(await isInsideRepo(path.join(repoRoot, 'src'))).toBe(true);
  });

  it('returns false when not inside a repo', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    expect(await isInsideRepo(path.resolve('not', 'a', 'repo'))).toBe(false);
  });
});

describe('getRepoName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the basename of the repo root', async () => {
    const repoRoot = path.resolve('home', 'user', 'my-project');
    mockStat.mockImplementation(async (p: Parameters<typeof stat>[0]) => {
      const pathStr = typeof p === 'string' ? p : p.toString();
      if (pathStr === path.join(repoRoot, '.git')) {
        return { isDirectory: () => true, isFile: () => false } as import('node:fs').Stats;
      }
      throw new Error('ENOENT');
    });

    const name = await getRepoName(path.join(repoRoot, 'src'));
    expect(name).toBe('my-project');
  });

  it('returns null when not in a repo', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    expect(await getRepoName(path.resolve('no', 'repo'))).toBeNull();
  });
});
