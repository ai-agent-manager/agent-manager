import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runHeadless } from '../../../src/headless.js';
import { importLocalBundle } from '../../../src/bundle/importer.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { readRepoConfig } from '../../../src/bundle/repo-config.js';
import { toCatalogueSkills, loadRepositoryBundle } from '../../../src/operations/catalogue.js';
import { installResolvedSkills } from '../../../src/operations/install.js';

let home: string;
vi.mock('../../../src/lib/platform.js', async (original) => ({ ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => home }));
beforeEach(async () => { home = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-parity-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(home, { recursive: true, force: true }); });

it('TUI catalogue and headless install use repository content and the same pin, despite a different global version', async () => {
  const source = path.join(home, 'source');
  const repoRoot = path.join(home, 'repo');
  await mkdir(path.join(source, 'repo-skill'), { recursive: true });
  await mkdir(repoRoot);
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ version: '2.0.0', published: '2026-01-01' }));
  await writeFile(path.join(source, 'repo-skill', 'SKILL.md'), '# Repository content');
  const imported = await importLocalBundle(source);
  const contents = await scanBundle(imported.bundleDir);
  const skills = toCatalogueSkills({
    source: { type: 'directory', dirPath: source },
    manifest: { version: '1.0.0', published: '2026-01-01' },
    bundleContents: { skills: [{ dirName: 'global-only', dirPath: '/example/global-only', skillMdPath: '/example/global-only/SKILL.md' }], rovoAgents: [] },
  }, { scope: 'repo', repoBundle: { version: '2.0.0', contents } });
  expect(skills.map((skill) => skill.dirName)).toEqual(['repo-skill']);
  expect(skills[0].sourcePin?.bundleVersion).toBe('2.0.0');
  expect((await installResolvedSkills({ skills, toolId: 'claude-code', scope: 'repo', repoRoot, bundleVersion: '2.0.0' })).errors).toEqual([]);
  const selected = await loadRepositoryBundle({ source: { type: 'directory', dirPath: source }, manifest: { version: '1.0.0', published: '2026-01-01' } }, repoRoot);
  expect(selected?.version).toBe('2.0.0');
  expect(selected?.contents.skills.map((skill) => skill.dirName)).toEqual(['repo-skill']);
  const configPath = path.join(home, 'headless.json');
  await writeFile(configPath, JSON.stringify({ tools: ['cursor'], scope: 'repo', skills: ['repo-skill'], bundleVersion: '2.0.0' }));
  vi.spyOn(process, 'cwd').mockReturnValue(repoRoot);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await runHeadless(source, configPath, false);
  const config = await readRepoConfig(repoRoot);
  const interactive = config!.installations['claude-code']['repo-skill'];
  const headless = config!.installations.cursor['repo-skill'];
  expect(interactive.sourcePin).toEqual(headless.sourcePin);
  expect(interactive.bundleVersion).toBe(headless.bundleVersion);
  expect(await readFile(path.join(repoRoot, '.claude', 'skills', 'repo-skill', 'SKILL.md'), 'utf8')).toBe('# Repository content');
  expect(await readFile(path.join(repoRoot, '.cursor', 'skills', 'repo-skill', 'SKILL.md'), 'utf8')).toBe('# Repository content');
});

it('reports a missing directory provenance marker without leaking a filesystem error', async () => {
  const source = path.join(home, 'source'), repo = path.join(home, 'repo');
  await mkdir(path.join(source, 'skill'), { recursive: true });
  await mkdir(repo);
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ version: '1.0.0', published: '2026-01-01' }));
  await writeFile(path.join(source, 'skill', 'SKILL.md'), '# Skill');
  const imported = await importLocalBundle(source);
  const state = { source: { type: 'directory' as const, dirPath: source }, manifest: imported.manifest, bundleContents: await scanBundle(imported.bundleDir) };
  await installResolvedSkills({ skills: toCatalogueSkills(state), toolId: 'claude-code', scope: 'repo', repoRoot: repo, bundleVersion: '1.0.0' });
  await rm(path.join(imported.bundleDir, '.source.json'));
  await expect(loadRepositoryBundle(state, repo)).rejects.toMatchObject({ name: 'OperationConflictError', message: expect.stringContaining('import it again') });
  try { await loadRepositoryBundle(state, repo); } catch (error) { expect((error as Error).message).not.toContain(home); }
});
