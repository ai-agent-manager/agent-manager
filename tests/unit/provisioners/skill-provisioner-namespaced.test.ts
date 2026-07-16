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

describe('SkillProvisioner — always-namespace flat link layout', () => {
  let bundleDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-always-ns-prov-'));
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

  // ── Single source: always-qualified link ─────────────────────────────────────

  it('installs a repo-sourced skill at ~/.claude/skills/<flatNs>__<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0].name).toBe('github.com/example-org/example-repo/test-skill');

    // Link is always qualified: flattenNamespace(namespace) + "__" + skillId
    const linkPath = path.join(tmpDir, '.claude', 'skills', 'github.com~example-org~example-repo__test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('installs an artefact-sourced skill at ~/.claude/skills/<flatNs>__<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/my-skill-1.0.0.zip'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed[0].name).toBe('cdn.example.com/my-skill/test-skill');

    const linkPath = path.join(tmpDir, '.claude', 'skills', 'cdn.example.com~my-skill__test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── Two sources, same skillId — both install, neither overwrites the other ────

  it('two skills with the same skillId from different sources both install without overwriting', async () => {
    const prov = new ClaudeCodeProvisioner();

    // Use distinct dirPaths so readlink assertions prove each link resolves to its OWN target.
    const skillFromA = makeSkill('test-skill');
    const skillFromB = {
      dirName: 'test-skill',
      dirPath: path.join(bundleDir, 'other-skill'),
      skillMdPath: path.join(bundleDir, 'other-skill', 'SKILL.md'),
      meta: null,
    };

    const r1 = await prov.install([skillFromA], '', repoPin('https://github.com/example-org/repo-a'));
    const r2 = await prov.install([skillFromB], '', repoPin('https://github.com/example-org/repo-b'));

    expect(r1.errors).toHaveLength(0);
    expect(r2.errors).toHaveLength(0);

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    const linkA = path.join(skillsDir, 'github.com~example-org~repo-a__test-skill');
    const linkB = path.join(skillsDir, 'github.com~example-org~repo-b__test-skill');

    // Each link resolves to its own distinct target — no silent overwrite.
    expect(await readlink(linkA)).toBe(path.join(bundleDir, 'test-skill'));
    expect(await readlink(linkB)).toBe(path.join(bundleDir, 'other-skill'));
  });

  it('link names are deterministic — source first, "__" separator, always qualified', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-a'));
    await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/test-skill-1.0.0.zip'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Repo namespace: github.com/example-org/repo-a → flattened: github.com~example-org~repo-a
    const repoLink = path.join(skillsDir, 'github.com~example-org~repo-a__test-skill');
    // Artefact namespace: cdn.example.com/test-skill → flattened: cdn.example.com~test-skill
    const artefactLink = path.join(skillsDir, 'cdn.example.com~test-skill__test-skill');

    expect(await readlink(repoLink)).toBe(path.join(bundleDir, 'test-skill'));
    expect(await readlink(artefactLink)).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('linkName leaves "-" and "." within segments unchanged — no colons or slashes (Windows-safe)', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = await (await import('node:fs/promises')).readdir(skillsDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe('github.com~example-org~example-repo__test-skill');
    for (const entry of entries) {
      expect(entry).not.toContain(':');
      expect(entry).not.toContain('/');
    }
  });

  // ── getInstalled returns config identity keyed by full namespaced key ────────

  it('getInstalled returns the full namespaced key as name and the flat link path', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    const installed = await prov.getInstalled();

    expect(installed).toHaveLength(1);
    expect(installed[0].name).toBe('github.com/example-org/example-repo/test-skill');
    expect(installed[0].path).toBe(
      path.join(tmpDir, '.claude', 'skills', 'github.com~example-org~example-repo__test-skill'),
    );
  });

  it('getInstalled returns both skills when two sources share the same skillId', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-b'));

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(2);

    const names = installed.map((s) => s.name);
    expect(names).toContain('github.com/example-org/repo-a/test-skill');
    expect(names).toContain('github.com/example-org/repo-b/test-skill');

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const paths = installed.map((s) => s.path);
    expect(paths).toContain(path.join(skillsDir, 'github.com~example-org~repo-a__test-skill'));
    expect(paths).toContain(path.join(skillsDir, 'github.com~example-org~repo-b__test-skill'));
  });

  // ── Uninstall removes only the targeted link ──────────────────────────────────

  it('uninstall(qualifiedKey) removes only that link, leaving the other intact', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-b'));

    const result = await prov.uninstall(['github.com/example-org/repo-b/test-skill']);

    expect(result.errors).toHaveLength(0);
    expect(result.removed).toEqual([{ name: 'github.com/example-org/repo-b/test-skill' }]);

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // repo-b link is gone
    await expect(stat(path.join(skillsDir, 'github.com~example-org~repo-b__test-skill'))).rejects.toThrow();

    // repo-a link still present
    const aTarget = await readlink(path.join(skillsDir, 'github.com~example-org~repo-a__test-skill'));
    expect(aTarget).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── Remove by bare skillId ────────────────────────────────────────────────────

  it('uninstall by bare skillId works when only one install matches', async () => {
    const prov = new ClaudeCodeProvisioner();
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    const result = await prov.uninstall(['test-skill']);

    expect(result.errors).toHaveLength(0);
    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  it('uninstall by bare skillId returns disambiguation error when multiple installs match', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-a'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-b'));

    const result = await prov.uninstall(['test-skill']);

    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Multiple installs match');
    expect(result.errors[0].error).toContain('github.com/example-org/repo-a/test-skill');
    expect(result.errors[0].error).toContain('github.com/example-org/repo-b/test-skill');
  });

  // ── Flat (legacy) installs — no sourcePin ────────────────────────────────────

  it('legacy flat install (no sourcePin) lands at ~/.claude/skills/<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], 'v1.0');

    expect(result.errors).toHaveLength(0);
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

  // ── getInstalled returns empty after all installs removed ─────────────────────

  it('getInstalled returns empty after a namespaced skill is uninstalled', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));
    await prov.uninstall(['github.com/example-org/example-repo/test-skill']);

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  // ── Skills dir stays flat — no nested directories created ────────────────────

  it('skills dir stays flat — no nested real directories are created inside it', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install(
      [makeSkill('test-skill'), makeSkill('other-skill')],
      '',
      repoPin('https://github.com/example-org/example-repo'),
    );

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const { readdir: rd } = await import('node:fs/promises');
    const entries = await rd(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      const s = await stat(path.join(skillsDir, entry.name));
      // Each entry should be a symlink, not a real directory
      expect(entry.isSymbolicLink()).toBe(true);
      expect(s.isDirectory() && !entry.isSymbolicLink()).toBe(false);
    }
  });

  // ── GHES namespace discrimination ─────────────────────────────────────────────

  it('github.com and GHES with identical org/repo produce different link names', async () => {
    const prov = new ClaudeCodeProvisioner();

    // Two repos: same org/repo path, different hosts
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.example-internal.com/example-org/example-repo'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    const publicLink = path.join(skillsDir, 'github.com~example-org~example-repo__test-skill');
    const ghesLink = path.join(skillsDir, 'github.example-internal.com~example-org~example-repo__test-skill');

    expect(await readlink(publicLink)).toBe(path.join(bundleDir, 'test-skill'));
    expect(await readlink(ghesLink)).toBe(path.join(bundleDir, 'test-skill'));
  });

  // ── Collision regression ──────────────────────────────────────────────────────

  it('repos that differ only by org/repo name containing "-" produce distinct link names', async () => {
    // Under the old /[/.]+/g -> '-' encoding both would flatten to the same token.
    // "github.com/acme/data-pipeline" and "github.com/acme-data/pipeline" are the
    // canonical colliding pair from the review.
    // The "~" separator makes the boundary unambiguous without escaping.
    const bundleDirA = path.join(tmpDir, 'source-a');
    const bundleDirB = path.join(tmpDir, 'source-b');
    await mkdir(path.join(bundleDirA, 'my-skill'), { recursive: true });
    await writeFile(path.join(bundleDirA, 'my-skill', 'SKILL.md'), '# my-skill from A');
    await mkdir(path.join(bundleDirB, 'my-skill'), { recursive: true });
    await writeFile(path.join(bundleDirB, 'my-skill', 'SKILL.md'), '# my-skill from B');

    const prov = new ClaudeCodeProvisioner();
    await prov.install(
      [{ dirName: 'my-skill', dirPath: path.join(bundleDirA, 'my-skill'), skillMdPath: path.join(bundleDirA, 'my-skill', 'SKILL.md'), meta: null }],
      '',
      repoPin('https://github.com/acme/data-pipeline'),
    );
    await prov.install(
      [{ dirName: 'my-skill', dirPath: path.join(bundleDirB, 'my-skill'), skillMdPath: path.join(bundleDirB, 'my-skill', 'SKILL.md'), meta: null }],
      '',
      repoPin('https://github.com/acme-data/pipeline'),
    );

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Distinct link names — "~" makes the boundary unambiguous.
    const linkA = path.join(skillsDir, 'github.com~acme~data-pipeline__my-skill');
    const linkB = path.join(skillsDir, 'github.com~acme-data~pipeline__my-skill');

    // Each resolves to its own target — no silent overwrite.
    expect(await readlink(linkA)).toBe(path.join(bundleDirA, 'my-skill'));
    expect(await readlink(linkB)).toBe(path.join(bundleDirB, 'my-skill'));
  });

  it('uninstalling one of the colliding pair leaves the other intact with no dangling record', async () => {
    const bundleDirA = path.join(tmpDir, 'source-a');
    const bundleDirB = path.join(tmpDir, 'source-b');
    await mkdir(path.join(bundleDirA, 'my-skill'), { recursive: true });
    await writeFile(path.join(bundleDirA, 'my-skill', 'SKILL.md'), '# my-skill from A');
    await mkdir(path.join(bundleDirB, 'my-skill'), { recursive: true });
    await writeFile(path.join(bundleDirB, 'my-skill', 'SKILL.md'), '# my-skill from B');

    const prov = new ClaudeCodeProvisioner();
    await prov.install(
      [{ dirName: 'my-skill', dirPath: path.join(bundleDirA, 'my-skill'), skillMdPath: path.join(bundleDirA, 'my-skill', 'SKILL.md'), meta: null }],
      '',
      repoPin('https://github.com/acme/data-pipeline'),
    );
    await prov.install(
      [{ dirName: 'my-skill', dirPath: path.join(bundleDirB, 'my-skill'), skillMdPath: path.join(bundleDirB, 'my-skill', 'SKILL.md'), meta: null }],
      '',
      repoPin('https://github.com/acme-data/pipeline'),
    );

    const result = await prov.uninstall(['github.com/acme-data/pipeline/my-skill']);
    expect(result.errors).toHaveLength(0);
    expect(result.removed).toEqual([{ name: 'github.com/acme-data/pipeline/my-skill' }]);

    // The survivor's link and record are intact.
    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const survivorLink = path.join(skillsDir, 'github.com~acme~data-pipeline__my-skill');
    expect(await readlink(survivorLink)).toBe(path.join(bundleDirA, 'my-skill'));

    const installed = await prov.getInstalled();
    const names = installed.map((s) => s.name);
    expect(names).toContain('github.com/acme/data-pipeline/my-skill');
    expect(names).not.toContain('github.com/acme-data/pipeline/my-skill');
  });
});
