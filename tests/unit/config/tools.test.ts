import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { SKILL_TOOLS, getToolById } from '../../../src/config/tools.js';
import { getHomeDir, getCursorSkillsDir } from '../../../src/lib/platform.js';

describe('SKILL_TOOLS', () => {
  it('contains exactly 4 tools', () => {
    expect(SKILL_TOOLS).toHaveLength(4);
  });

  it('has the expected tool IDs', () => {
    const ids = SKILL_TOOLS.map((t) => t.id);
    expect(ids).toEqual(['claude-code', 'windsurf', 'github-copilot', 'cursor']);
  });

  it('each tool has a name, id, getSkillsDir, and getRepoSkillsDir function', () => {
    for (const tool of SKILL_TOOLS) {
      expect(typeof tool.id).toBe('string');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.getSkillsDir).toBe('function');
      expect(typeof tool.getRepoSkillsDir).toBe('function');
    }
  });

  it('returns correct skills directory for claude-code', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'claude-code')!;
    const dir = tool.getSkillsDir();
    expect(dir).toContain('.claude');
    expect(dir).toContain('skills');
    expect(dir.startsWith(getHomeDir())).toBe(true);
  });

  it('returns correct skills directory for windsurf', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'windsurf')!;
    const dir = tool.getSkillsDir();
    expect(dir).toContain('.codeium');
    expect(dir).toContain('windsurf');
    expect(dir).toContain('skills');
  });

  it('returns correct skills directory for github-copilot', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'github-copilot')!;
    const dir = tool.getSkillsDir();
    expect(dir).toContain('.copilot');
    expect(dir).toContain('skills');
  });

  it('returns correct skills directory for cursor', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'cursor')!;
    const dir = tool.getSkillsDir();
    expect(dir).toBe(getCursorSkillsDir());
    expect(dir).toContain('skills');
  });
});

describe('getRepoSkillsDir', () => {
  const repoRoot = path.resolve('home', 'user', 'my-project');

  it('claude-code returns <repo>/.claude/skills/', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'claude-code')!;
    expect(tool.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, '.claude', 'skills'));
  });

  it('windsurf returns <repo>/.windsurf/skills/', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'windsurf')!;
    expect(tool.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, '.windsurf', 'skills'));
  });

  it('github-copilot returns <repo>/.github/copilot/skills/', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'github-copilot')!;
    expect(tool.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, '.github', 'copilot', 'skills'));
  });

  it('cursor returns <repo>/.cursor/skills/', () => {
    const tool = SKILL_TOOLS.find((t) => t.id === 'cursor')!;
    expect(tool.getRepoSkillsDir(repoRoot)).toBe(path.join(repoRoot, '.cursor', 'skills'));
  });

  it('repo paths are different from system paths', () => {
    for (const tool of SKILL_TOOLS) {
      const systemDir = tool.getSkillsDir();
      const repoDir = tool.getRepoSkillsDir(repoRoot);
      expect(repoDir).not.toBe(systemDir);
      expect(repoDir.startsWith(repoRoot)).toBe(true);
    }
  });
});

describe('getToolById', () => {
  it('returns the correct tool for a known ID', () => {
    const tool = getToolById('claude-code');
    expect(tool).toBeDefined();
    expect(tool!.id).toBe('claude-code');
    expect(tool!.name).toBe('Claude Code');
  });

  it('returns undefined for an unknown ID', () => {
    expect(getToolById('unknown-tool')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getToolById('')).toBeUndefined();
  });
});
