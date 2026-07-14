import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanRepoForSkills } from '../../../src/bundle/repo-scanner.js';
import type { RepoSkillSource } from '../../../src/bundle/skill-source.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<RepoSkillSource> = {}): RepoSkillSource {
  return {
    type: 'repo',
    repoUrl: 'https://github.com/org/my-skills',
    ref: 'main',
    installLayout: 'namespaced',
    ...overrides,
  };
}

async function createSkill(baseDir: string, skillName: string, frontmatter?: string): Promise<void> {
  const skillDir = path.join(baseDir, skillName);
  await mkdir(skillDir, { recursive: true });
  const fm = frontmatter ?? `---\nname: ${skillName}\ndescription: A test skill\n---\n`;
  await writeFile(path.join(skillDir, 'SKILL.md'), fm, 'utf-8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `agentman-scanner-test-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('scanRepoForSkills — skills/ directory', () => {
  it('finds a single skill under skills/', async () => {
    await createSkill(path.join(tmpDir, 'skills'), 'my-skill');

    const result = await scanRepoForSkills(tmpDir, makeSource());

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('my-skill');
  });

  it('finds multiple skills under skills/', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await createSkill(skillsDir, 'skill-a');
    await createSkill(skillsDir, 'skill-b');
    await createSkill(skillsDir, 'skill-c');

    const result = await scanRepoForSkills(tmpDir, makeSource());

    expect(result.skills).toHaveLength(3);
    const names = result.skills.map((s) => s.dirName).sort();
    expect(names).toEqual(['skill-a', 'skill-b', 'skill-c']);
  });

  it('returns correct dirPath and skillMdPath for each skill', async () => {
    await createSkill(path.join(tmpDir, 'skills'), 'my-skill');

    const result = await scanRepoForSkills(tmpDir, makeSource());

    const skill = result.skills[0];
    expect(skill.dirPath).toBe(path.join(tmpDir, 'skills', 'my-skill'));
    expect(skill.skillMdPath).toBe(path.join(tmpDir, 'skills', 'my-skill', 'SKILL.md'));
  });

  it('exposes the resolved skillsDir', async () => {
    await createSkill(path.join(tmpDir, 'skills'), 'my-skill');

    const result = await scanRepoForSkills(tmpDir, makeSource());

    expect(result.skillsDir).toBe(path.join(tmpDir, 'skills'));
  });

  it('ignores directories without SKILL.md', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await createSkill(skillsDir, 'real-skill');
    // Directory with no SKILL.md
    await mkdir(path.join(skillsDir, 'not-a-skill'), { recursive: true });

    const result = await scanRepoForSkills(tmpDir, makeSource());

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('real-skill');
  });

  it('throws when skills/ directory does not exist', async () => {
    await expect(scanRepoForSkills(tmpDir, makeSource())).rejects.toThrow(
      'No skills/ directory found',
    );
  });

  it('throws when skills/ exists but has no SKILL.md files', async () => {
    const skillsDir = path.join(tmpDir, 'skills');
    await mkdir(skillsDir, { recursive: true });
    // Empty dir
    await expect(scanRepoForSkills(tmpDir, makeSource())).rejects.toThrow(
      'No skills found',
    );
  });
});

describe('scanRepoForSkills — specific skillPath', () => {
  it('finds a single skill at a specific skillPath', async () => {
    await createSkill(path.join(tmpDir, 'skills'), 'api-backend-skill');

    const source = makeSource({ skillPath: 'skills/api-backend-skill' });
    const result = await scanRepoForSkills(tmpDir, source);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('api-backend-skill');
  });

  it('throws when skillPath directory does not exist', async () => {
    const source = makeSource({ skillPath: 'skills/missing-skill' });

    await expect(scanRepoForSkills(tmpDir, source)).rejects.toThrow(
      'Skill path not found',
    );
  });

  it('throws when skillPath exists but has no SKILL.md', async () => {
    const skillDir = path.join(tmpDir, 'skills', 'no-skill-md');
    await mkdir(skillDir, { recursive: true });

    const source = makeSource({ skillPath: 'skills/no-skill-md' });

    await expect(scanRepoForSkills(tmpDir, source)).rejects.toThrow(
      'No SKILL.md found',
    );
  });
});
