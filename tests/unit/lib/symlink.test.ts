import { describe, it, expect, vi } from 'vitest';

// Mock node:fs/promises so we can control readlink behavior
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readlink: vi.fn(),
  };
});

import { resolveSkillVersion } from '../../../src/lib/symlink.js';
import { readlink } from 'node:fs/promises';

const mockReadlink = vi.mocked(readlink);

describe('resolveSkillVersion', () => {
  it('extracts the version hash from a valid symlink target', async () => {
    mockReadlink.mockResolvedValue(
      '/home/user/.agentman/bundles/abc123def/my-skill' as never
    );
    const version = await resolveSkillVersion('/some/link/path');
    expect(version).toBe('abc123def');
  });

  it('works with Unix-style paths', async () => {
    mockReadlink.mockResolvedValue(
      '/Users/dev/.agentman/bundles/a1b2c3d4e5f6/.hidden-skill' as never
    );
    const version = await resolveSkillVersion('/any/path');
    expect(version).toBe('a1b2c3d4e5f6');
  });

  it('works with Windows-style backslash paths', async () => {
    mockReadlink.mockResolvedValue(
      'C:\\Users\\dev\\.agentman\\bundles\\win123hash\\some-skill' as never
    );
    const version = await resolveSkillVersion('C:\\some\\link');
    expect(version).toBe('win123hash');
  });

  it('returns null when link does not point into agentman bundles', async () => {
    mockReadlink.mockResolvedValue(
      '/home/user/some-other-path/skills/my-skill' as never
    );
    const version = await resolveSkillVersion('/some/link');
    expect(version).toBeNull();
  });

  it('returns null when readlink throws (not a symlink)', async () => {
    mockReadlink.mockRejectedValue(new Error('EINVAL: not a symlink') as never);
    const version = await resolveSkillVersion('/not/a/symlink');
    expect(version).toBeNull();
  });

  it('handles paths where .agentman/bundles/ is at the end with no version', async () => {
    mockReadlink.mockResolvedValue(
      '/home/user/.agentman/bundles/' as never
    );
    const version = await resolveSkillVersion('/some/link');
    // The regex requires at least one character after bundles/
    expect(version).toBeNull();
  });
});
