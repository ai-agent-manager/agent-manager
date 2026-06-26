import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateSkillDirectory } from '../../../src/contribute/validate.js';

describe('validateSkillDirectory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `validate-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns valid for skill directory with SKILL.md and valid frontmatter', async () => {
    const skillDir = path.join(tempDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: A wonderful skill
tags:
  - test
---

# My Skill

Some content here.`,
    );

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.skillName).toBe('my-skill');
    expect(result.description).toBe('A wonderful skill');
  });

  it('returns error when directory does not exist', async () => {
    const result = await validateSkillDirectory('/nonexistent/path/skill');

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('directory');
    expect(result.errors[0]!.message).toContain('Directory not found');
    expect(result.skillName).toBeNull();
    expect(result.description).toBeNull();
  });

  it('returns error when SKILL.md is missing', async () => {
    const skillDir = path.join(tempDir, 'empty-skill');
    await mkdir(skillDir, { recursive: true });

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('SKILL.md');
    expect(result.errors[0]!.message).toContain('SKILL.md not found');
    expect(result.skillName).toBeNull();
    expect(result.description).toBeNull();
  });

  it('returns error when frontmatter is missing', async () => {
    const skillDir = path.join(tempDir, 'no-frontmatter-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '# Just markdown\n\nNo frontmatter here.');

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('frontmatter');
    expect(result.errors[0]!.message).toBe('Failed to parse frontmatter in SKILL.md');
  });

  it('returns error when name is missing but description is present', async () => {
    const skillDir = path.join(tempDir, 'no-name-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
description: A skill without a name
---

# Missing Name`,
    );

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('name');
    expect(result.skillName).toBeNull();
    expect(result.description).toBe('A skill without a name');
  });

  it('returns error when description is missing but name is present', async () => {
    const skillDir = path.join(tempDir, 'no-desc-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
name: my-skill
---

# Missing Description`,
    );

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('description');
    expect(result.skillName).toBe('my-skill');
    expect(result.description).toBeNull();
  });

  it('returns errors when both name and description are missing', async () => {
    const skillDir = path.join(tempDir, 'no-both-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---
tags:
  - test
---

# Missing Both`,
    );

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.field)).toEqual(['name', 'description']);
    expect(result.skillName).toBeNull();
    expect(result.description).toBeNull();
  });

  it('returns error for empty directory', async () => {
    const skillDir = path.join(tempDir, 'empty-skill');
    await mkdir(skillDir, { recursive: true });

    const result = await validateSkillDirectory(skillDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe('SKILL.md');
  });
});
