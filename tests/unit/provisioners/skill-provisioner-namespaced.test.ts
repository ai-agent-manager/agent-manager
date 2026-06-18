import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeProvisioner } from '../../../src/provisioners/ClaudeCodeProvisioner.js';
import type { SkillInfo } from '../../../src/bundle/scanner.js';
import type { SkillSourcePin } from '../../../src/bundle/skill-source.js';
import { vi } from 'vitest';

let tmpDir: string;

vi.mock('../../../src/lib/platform.js', () => ({
  getHomeDir: () => tmpDir,
  getPlatform: vi.fn(() => 'macos'),
}));

const repoPin = (repoUrl: string): SkillSourcePin => ({
  sourceType: 'repo',
  installLayout: 'namespaced',
  repoUrl,
  ref: 'main',
});

const artefactPin = (artefactUrl: string): SkillSourcePin => ({
  sourceType: 'artefact',
  installLayout: 'namespaced',
  artefactUrl,
  artefactVersion: '1.0.0',
});

describe('SkillProvisioner — flat link layout', () => {
  let bundleDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-flat-prov-'));
    bundleDir = path.join(tmpDir, 'bundle');

    for (const skillName of ['test-skill', 'other-skill']) {
      const skillDir = path.join(bundleDir, skillName);
      await mkdir(skillDir, { recursive: true });
      await writeFile(path.join(skillDir, 'SKILL.md'), `# ${skillName}`);
    }
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeSkill(name: string): SkillInfo {
    return {
      dirName: name,
      dirPath: path.join(bundleDir, name),
      skillMdPath: path.join(bundleDir, name, 'SKILL.md'),
      meta: null,
    };
  }

  // ── Single source: flat, one-level link ─────────────────────────────────────

  it('installs a repo-sourced skill as a single flat link at ~/.claude/skills/<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/my-org/my-repo'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0].name).toBe('github.com/my-org/my-repo/test-skill');

    const linkPath = path.join(tmpDir, '.claude', 'skills', 'test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('installs an artefact-sourced skill as a single flat link at ~/.claude/skills/<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/my-skill-1.0.0.zip'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed[0].name).toBe('cdn.example.com/my-skill/test-skill');

    const linkPath = path.join(tmpDir, '.claude', 'skills', 'test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── getInstalled returns config identity keyed by full namespaced key ────────

  it('getInstalled returns the full namespaced key as name and the flat path', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/my-org/my-repo'));

    const installed = await prov.getInstalled();

    expect(installed).toHaveLength(1);
    expect(installed[0].name).toBe('github.com/my-org/my-repo/test-skill');
    expect(installed[0].path).toBe(path.join(tmpDir, '.claude', 'skills', 'test-skill'));
  });

  // ── Collision: first keeps clean name, second gets qualified name ────────────

  it('first install keeps bare skillId; second from different source gets qualified linkName', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-b/repo-b'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // First install claims the clean name
    const cleanLink = path.join(skillsDir, 'test-skill');
    const cleanTarget = await readlink(cleanLink);
    expect(cleanTarget).toBe(path.join(bundleDir, 'test-skill'));

    // Second install gets the qualified name ("/" → "-", "." preserved)
    const qualifiedLink = path.join(skillsDir, 'test-skill__github.com-org-b-repo-b');
    const qualifiedTarget = await readlink(qualifiedLink);
    expect(qualifiedTarget).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('both colliding skills appear in getInstalled, each resolving to their flat link', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-b/repo-b'));

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(2);

    const names = installed.map((s) => s.name);
    expect(names).toContain('github.com/org-a/repo-a/test-skill');
    expect(names).toContain('github.com/org-b/repo-b/test-skill');

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const paths = installed.map((s) => s.path);
    expect(paths).toContain(path.join(skillsDir, 'test-skill'));
    expect(paths).toContain(path.join(skillsDir, 'test-skill__github.com-org-b-repo-b'));
  });

  // ── linkName is deterministic and filesystem-safe ───────────────────────────

  it('qualified linkName replaces "/" and "." with "-" in the namespace', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/test-skill-1.0.0.zip'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    // Artefact namespace is "cdn.example.com/test-skill"; flattened ("/" → "-"): "cdn.example.com-test-skill"
    const qualifiedLink = path.join(skillsDir, 'test-skill__cdn.example.com-test-skill');
    const target = await readlink(qualifiedLink);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── Uninstall removes only the targeted link ─────────────────────────────────

  it('uninstall(qualifiedKey) removes only the qualified link, leaving the clean one intact', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-b/repo-b'));

    const result = await prov.uninstall(['github.com/org-b/repo-b/test-skill']);

    expect(result.errors).toHaveLength(0);
    expect(result.removed).toEqual([{ name: 'github.com/org-b/repo-b/test-skill' }]);

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Qualified link is gone
    await expect(stat(path.join(skillsDir, 'test-skill__github.com-org-b-repo-b'))).rejects.toThrow();

    // Clean link still present
    const cleanTarget = await readlink(path.join(skillsDir, 'test-skill'));
    expect(cleanTarget).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('uninstall(cleanKey) removes only the clean link', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-b/repo-b'));

    const result = await prov.uninstall(['github.com/org-a/repo-a/test-skill']);

    expect(result.errors).toHaveLength(0);

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Clean link is gone
    await expect(stat(path.join(skillsDir, 'test-skill'))).rejects.toThrow();

    // Qualified link still present
    const qualTarget = await readlink(path.join(skillsDir, 'test-skill__github.com-org-b-repo-b'));
    expect(qualTarget).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── Remove by bare skillId ────────────────────────────────────────────────────

  it('uninstall by bare skillId works when only one install matches', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/my-org/my-repo'));

    const result = await prov.uninstall(['test-skill']);

    expect(result.errors).toHaveLength(0);
    expect(result.removed).toEqual([{ name: 'test-skill' }]);

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  it('uninstall by bare skillId errors with disambiguation message when multiple installs match', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-a/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/org-b/repo-b'));

    const result = await prov.uninstall(['test-skill']);

    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Multiple installs match/);
    expect(result.errors[0].error).toContain('github.com/org-a/repo-a/test-skill');
    expect(result.errors[0].error).toContain('github.com/org-b/repo-b/test-skill');
  });

  // ── Flat (legacy) installs — no sourcePin ───────────────────────────────────

  it('legacy flat install (no sourcePin) lands at ~/.claude/skills/<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], 'v1.0');

    expect(result.installed[0].name).toBe('test-skill');
    const linkPath = path.join(tmpDir, '.claude', 'skills', 'test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('getInstalled lists a legacy flat install with its bare name', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], 'v1.0');

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].name).toBe('test-skill');
    expect(installed[0].path).toBe(path.join(tmpDir, '.claude', 'skills', 'test-skill'));
  });

  it('legacy flat install is removable by bare id', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], 'v1.0');

    const result = await prov.uninstall(['test-skill']);

    expect(result.errors).toHaveLength(0);
    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  // ── Orphaned flat installs (no config record) still listed ───────────────────

  it('getInstalled lists an orphaned flat entry that has no config record', async () => {
    const prov = new ClaudeCodeProvisioner();

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    await mkdir(path.join(skillsDir, 'orphan-skill'), { recursive: true });
    await writeFile(path.join(skillsDir, 'orphan-skill', 'SKILL.md'), '# Orphan');

    const installed = await prov.getInstalled();
    expect(installed.map((s) => s.name)).toContain('orphan-skill');
  });

  // ── getInstalled returns empty after all installs removed ────────────────────

  it('getInstalled returns empty after a namespaced skill is uninstalled', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/my-org/my-repo'));
    await prov.uninstall(['github.com/my-org/my-repo/test-skill']);

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  // ── No nested directories created under skills dir ───────────────────────────

  it('skills dir stays flat — no subdirectories are created inside it', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill'), makeSkill('other-skill')], '', repoPin('https://github.com/my-org/my-repo'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const { readdir: rd } = await import('node:fs/promises');
    const entries = await rd(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const s = await stat(path.join(skillsDir, entry.name));
      expect(s.isDirectory() && !entry.isSymbolicLink()).toBe(false);
    }
  });
});
