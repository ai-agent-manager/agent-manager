import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { scanArtefactForSkills } from '../../../src/bundle/artefact-scanner.js';
import type { ArtefactSkillSource } from '../../../src/bundle/skill-source.js';

function makeSource(artefactUrl = 'https://cdn.example.com/my-skill-1.2.0.zip'): ArtefactSkillSource {
  return { type: 'artefact', artefactUrl, installLayout: 'namespaced' };
}

const SKILL_MD = `---
name: Test Skill
description: A test skill
---
# Test Skill
`;

const README_MD = `---
name: Readme Name
description: Readme description
tags:
  - testing
---
# Docs
`;

describe('scanArtefactForSkills', () => {
  let extractDir = '';

  beforeEach(async () => {
    extractDir = path.join(os.tmpdir(), `agentman-artefact-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(extractDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(extractDir, { recursive: true, force: true });
  });

  it('resolves a single-skill artefact with SKILL.md at the root', async () => {
    await writeFile(path.join(extractDir, 'SKILL.md'), SKILL_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('my-skill');
    expect(result.skills[0].dirPath).toBe(extractDir);
    expect(result.skills[0].skillMdPath).toBe(path.join(extractDir, 'SKILL.md'));
  });

  it('prefers README.md frontmatter for root-level skill metadata', async () => {
    await writeFile(path.join(extractDir, 'SKILL.md'), SKILL_MD);
    await writeFile(path.join(extractDir, 'README.md'), README_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills[0].meta?.name).toBe('Readme Name');
  });

  it('falls back to SKILL.md frontmatter when README.md is absent', async () => {
    await writeFile(path.join(extractDir, 'SKILL.md'), SKILL_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills[0].meta?.name).toBe('Test Skill');
  });

  it('discovers skill directories at the artefact root (bundle layout)', async () => {
    await mkdir(path.join(extractDir, 'skill-a'), { recursive: true });
    await mkdir(path.join(extractDir, 'skill-b'), { recursive: true });
    await writeFile(path.join(extractDir, 'skill-a', 'SKILL.md'), SKILL_MD);
    await writeFile(path.join(extractDir, 'skill-b', 'SKILL.md'), SKILL_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills.map((s) => s.dirName).sort()).toEqual(['skill-a', 'skill-b']);
    expect(result.skillsDir).toBe(extractDir);
  });

  it('descends into a single top-level wrapper directory', async () => {
    const wrapper = path.join(extractDir, 'my-skill-1.2.0');
    await mkdir(path.join(wrapper, 'skill-a'), { recursive: true });
    await writeFile(path.join(wrapper, 'skill-a', 'SKILL.md'), SKILL_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('skill-a');
    expect(result.skillsDir).toBe(wrapper);
  });

  it('treats a wrapper directory containing SKILL.md directly as a skill', async () => {
    const wrapper = path.join(extractDir, 'my-skill');
    await mkdir(wrapper, { recursive: true });
    await writeFile(path.join(wrapper, 'SKILL.md'), SKILL_MD);

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('my-skill');
  });

  it('ignores the .artefact.json metadata file', async () => {
    await writeFile(path.join(extractDir, 'SKILL.md'), SKILL_MD);
    await writeFile(path.join(extractDir, '.artefact.json'), '{}');

    const result = await scanArtefactForSkills(extractDir, makeSource());

    expect(result.skills).toHaveLength(1);
  });

  it('throws a descriptive error when the artefact contains no skills', async () => {
    await writeFile(path.join(extractDir, 'README.md'), '# nothing here');

    await expect(scanArtefactForSkills(extractDir, makeSource())).rejects.toThrow(
      'No skills found in artefact',
    );
  });

  it('throws when a wrapper directory contains no skills either', async () => {
    await mkdir(path.join(extractDir, 'empty-wrapper', 'docs'), { recursive: true });

    await expect(scanArtefactForSkills(extractDir, makeSource())).rejects.toThrow(
      'No skills found in artefact',
    );
  });
});
