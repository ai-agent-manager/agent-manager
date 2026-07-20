import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeProvisioner } from '../../../src/provisioners/ClaudeCodeProvisioner.js';
import type { SkillInfo } from '../../../src/bundle/scanner.js';
import type { SkillSourcePin } from '../../../src/bundle/skill-source.js';
import { recordInstall } from '../../../src/bundle/cache.js';
import { createLink } from '../../../src/lib/symlink.js';
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

  it('installs a repo-sourced skill at ~/.claude/skills/<flatNs>~<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed).toHaveLength(1);
    expect(result.installed[0].name).toBe('github.com/example-org/example-repo/test-skill');

    // Link is always qualified: flattenNamespace(namespace) + "~" + skillId
    const linkPath = path.join(tmpDir, '.claude', 'skills', 'github.com~example-org~example-repo~test-skill');
    const target = await readlink(linkPath);
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('installs an artefact-sourced skill at ~/.claude/skills/<flatNs>~<skillId>/', async () => {
    const prov = new ClaudeCodeProvisioner();

    const result = await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/my-skill-1.0.0.zip'));

    expect(result.errors).toHaveLength(0);
    expect(result.installed[0].name).toBe('cdn.example.com/my-skill/test-skill');

    const linkPath = path.join(tmpDir, '.claude', 'skills', 'cdn.example.com~my-skill~test-skill');
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

    const linkA = path.join(skillsDir, 'github.com~example-org~repo-a~test-skill');
    const linkB = path.join(skillsDir, 'github.com~example-org~repo-b~test-skill');

    // Each link resolves to its own distinct target — no silent overwrite.
    expect(await readlink(linkA)).toBe(path.join(bundleDir, 'test-skill'));
    expect(await readlink(linkB)).toBe(path.join(bundleDir, 'other-skill'));
  });

  it('link names are deterministic — source first, "~" separator, always qualified', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-a'));
    await prov.install([makeSkill('test-skill')], '', artefactPin('https://cdn.example.com/test-skill-1.0.0.zip'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Repo namespace: github.com/example-org/repo-a → flattened: github.com~example-org~repo-a
    const repoLink = path.join(skillsDir, 'github.com~example-org~repo-a~test-skill');
    // Artefact namespace: cdn.example.com/test-skill → flattened: cdn.example.com~test-skill
    const artefactLink = path.join(skillsDir, 'cdn.example.com~test-skill~test-skill');

    expect(await readlink(repoLink)).toBe(path.join(bundleDir, 'test-skill'));
    expect(await readlink(artefactLink)).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('linkName leaves "-" and "." within segments unchanged — no colons or slashes (Windows-safe)', async () => {
    const prov = new ClaudeCodeProvisioner();

    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');
    const entries = await (await import('node:fs/promises')).readdir(skillsDir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe('github.com~example-org~example-repo~test-skill');
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
      path.join(tmpDir, '.claude', 'skills', 'github.com~example-org~example-repo~test-skill'),
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
    expect(paths).toContain(path.join(skillsDir, 'github.com~example-org~repo-a~test-skill'));
    expect(paths).toContain(path.join(skillsDir, 'github.com~example-org~repo-b~test-skill'));
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
    await expect(stat(path.join(skillsDir, 'github.com~example-org~repo-b~test-skill'))).rejects.toThrow();

    // repo-a link still present
    const aTarget = await readlink(path.join(skillsDir, 'github.com~example-org~repo-a~test-skill'));
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

  it('uninstall by bare skillId is ambiguous when a legacy bare record and a namespaced record from a different source share the id', async () => {
    const prov = new ClaudeCodeProvisioner();
    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Seed a legacy bare-key install for source A — no linkName, pre-PR shape.
    await mkdir(skillsDir, { recursive: true });
    await createLink(path.join(bundleDir, 'test-skill'), path.join(skillsDir, 'test-skill'));
    await recordInstall('claude-code', 'test-skill', {
      installedAt: new Date().toISOString(),
      method: 'symlink',
      sourcePin: repoPin('https://github.com/example-org/repo-a'),
    });

    // Install a namespaced skill for a DIFFERENT source (repo-b) with the same dirName.
    // Different source namespace, so Fix 3's migration does not touch the legacy record above.
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/repo-b'));

    const result = await prov.uninstall(['test-skill']);

    expect(result.removed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('Multiple installs match');
    expect(result.errors[0].error).toContain('github.com/example-org/repo-b/test-skill');

    // Neither install was guessed-and-removed — both remain untouched.
    const legacyTarget = await readlink(path.join(skillsDir, 'test-skill'));
    expect(legacyTarget).toBe(path.join(bundleDir, 'test-skill'));
    const namespacedTarget = await readlink(path.join(skillsDir, 'github.com~example-org~repo-b~test-skill'));
    expect(namespacedTarget).toBe(path.join(bundleDir, 'test-skill'));
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
      // Each entry should be a symlink, not a real directory
      expect(entry.isSymbolicLink()).toBe(true);
    }
  });

  // ── GHES namespace discrimination ─────────────────────────────────────────────

  it('github.com and GHES with identical org/repo produce different link names', async () => {
    const prov = new ClaudeCodeProvisioner();

    // Two repos: same org/repo path, different hosts
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.com/example-org/example-repo'));
    await prov.install([makeSkill('test-skill')], '', repoPin('https://github.example-internal.com/example-org/example-repo'));

    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    const publicLink = path.join(skillsDir, 'github.com~example-org~example-repo~test-skill');
    const ghesLink = path.join(skillsDir, 'github.example-internal.com~example-org~example-repo~test-skill');

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
    const linkA = path.join(skillsDir, 'github.com~acme~data-pipeline~my-skill');
    const linkB = path.join(skillsDir, 'github.com~acme-data~pipeline~my-skill');

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
    const survivorLink = path.join(skillsDir, 'github.com~acme~data-pipeline~my-skill');
    expect(await readlink(survivorLink)).toBe(path.join(bundleDirA, 'my-skill'));

    const installed = await prov.getInstalled();
    const names = installed.map((s) => s.name);
    expect(names).toContain('github.com/acme/data-pipeline/my-skill');
    expect(names).not.toContain('github.com/acme-data/pipeline/my-skill');
  });

  // ── dirName charset guard ─────────────────────────────────────────────────────

  it('throws when a namespaced skill dirName contains "~"', async () => {
    const prov = new ClaudeCodeProvisioner();
    const badSkill: SkillInfo = {
      dirName: 'weird~skill',
      dirPath: path.join(bundleDir, 'test-skill'),
      skillMdPath: path.join(bundleDir, 'test-skill', 'SKILL.md'),
      meta: null,
    };

    const result = await prov.install(
      [badSkill],
      '',
      repoPin('https://github.com/example-org/example-repo'),
    );

    expect(result.installed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('~');

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(0);
  });

  // ── linkName collision guard ──────────────────────────────────────────────────

  it('refuses to silently replace a link already owned by a different install key', async () => {
    const prov = new ClaudeCodeProvisioner();
    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Seed a record whose stored linkName collides with what the next install computes,
    // under an unrelated install key — the only way to force the guard's precondition,
    // since normal derivation can no longer produce a genuine collision.
    const collidingLinkName = 'github.com~example-org~example-repo~test-skill';
    await mkdir(path.join(skillsDir, collidingLinkName), { recursive: true });
    await recordInstall('claude-code', 'some-other-key/test-skill', {
      installedAt: new Date().toISOString(),
      method: 'copy',
      linkName: collidingLinkName,
    });

    const result = await prov.install(
      [makeSkill('test-skill')],
      '',
      repoPin('https://github.com/example-org/example-repo'),
    );

    expect(result.installed).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('already used by install');
  });

  // ── artefact URL mismatch guard (non-release-style) ───────────────────────────

  it('throws when an install key already points at a different non-release-style artefact URL', async () => {
    const prov = new ClaudeCodeProvisioner();

    const r1 = await prov.install(
      [makeSkill('test-skill')],
      '',
      artefactPin('https://cdn.example.com/my-skill.zip'),
    );
    expect(r1.errors).toHaveLength(0);

    const r2 = await prov.install(
      [makeSkill('test-skill')],
      '',
      artefactPin('https://cdn.example.com/other-dir/my-skill.zip'),
    );

    expect(r2.installed).toHaveLength(0);
    expect(r2.errors).toHaveLength(1);
    expect(r2.errors[0].error).toContain('different artefact URL');

    // The original install is untouched.
    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].name).toBe('cdn.example.com/my-skill/test-skill');
  });

  // ── Legacy bare-key migration ──────────────────────────────────────────────────

  it('migrates a legacy bare-key install of the same source to the namespaced link/record', async () => {
    const prov = new ClaudeCodeProvisioner();
    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    // Seed a pre-PR legacy install: bare link + bare-key record carrying sourcePin, no linkName.
    await mkdir(skillsDir, { recursive: true });
    await createLink(path.join(bundleDir, 'test-skill'), path.join(skillsDir, 'test-skill'));
    await recordInstall('claude-code', 'test-skill', {
      installedAt: new Date().toISOString(),
      method: 'symlink',
      sourcePin: repoPin('https://github.com/example-org/example-repo'),
    });

    const result = await prov.install(
      [makeSkill('test-skill')],
      '',
      repoPin('https://github.com/example-org/example-repo'),
    );

    expect(result.errors).toHaveLength(0);

    const installed = await prov.getInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].name).toBe('github.com/example-org/example-repo/test-skill');

    // Legacy bare link and record are gone — not left dangling alongside the new one.
    await expect(stat(path.join(skillsDir, 'test-skill'))).rejects.toThrow();

    const target = await readlink(path.join(skillsDir, 'github.com~example-org~example-repo~test-skill'));
    expect(target).toBe(path.join(bundleDir, 'test-skill'));
  });

  it('never migrates a bundle-sourced bare record — bundle sources stay flat permanently', async () => {
    const prov = new ClaudeCodeProvisioner();
    const skillsDir = path.join(tmpDir, '.claude', 'skills');

    const bundlePin: SkillSourcePin = {
      sourceType: 'bundle',
      installLayout: 'flat',
      bundleVersion: 'v1.0',
    };

    // Seed a bundle-sourced bare install with the same dirName as the repo skill below.
    await mkdir(skillsDir, { recursive: true });
    await createLink(path.join(bundleDir, 'test-skill'), path.join(skillsDir, 'test-skill'));
    await recordInstall('claude-code', 'test-skill', {
      installedAt: new Date().toISOString(),
      method: 'symlink',
      bundleVersion: 'v1.0',
      sourcePin: bundlePin,
    });

    const result = await prov.install(
      [makeSkill('test-skill')],
      '',
      repoPin('https://github.com/example-org/example-repo'),
    );

    expect(result.errors).toHaveLength(0);

    // Bundle install is untouched: its link and bare-key record both survive.
    const bundleTarget = await readlink(path.join(skillsDir, 'test-skill'));
    expect(bundleTarget).toBe(path.join(bundleDir, 'test-skill'));

    const installed = await prov.getInstalled();
    const names = installed.map((s) => s.name);
    expect(names).toContain('test-skill');
    expect(names).toContain('github.com/example-org/example-repo/test-skill');
    expect(installed).toHaveLength(2);
  });
});
