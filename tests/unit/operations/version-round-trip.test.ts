vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>() }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSourcePin, type SkillSourcePin } from '../../../src/bundle/skill-source.js';
import { bundleDirectoryForPin, readBundleIdentity } from '../../../src/bundle/version-identity.js';
import { readConfig, recordInstall, removeCachedBundle, setCurrentBundle, updateSkillVersion, getCurrentBundleVersion } from '../../../src/bundle/cache.js';
import { readRepoConfig } from '../../../src/bundle/repo-config.js';
import { createSkillProvisioner } from '../../../src/provisioners/registry.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { listInstalled, updateInstalled } from '../../../src/operations/manage.js';
import { listInstalledSkillVersions, switchInstalledSkillVersion } from '../../../src/operations/versions.js';
import { getPlatform } from '../../../src/lib/platform.js';

let home: string;
vi.mock('../../../src/lib/platform.js', async (original) => ({
  ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => home, getPlatform: vi.fn(() => 'linux'),
}));
vi.mock('../../../src/bundle/downloader.js', async (original) => ({
  ...await original<typeof import('../../../src/bundle/downloader.js')>(),
  downloadBundle: vi.fn(async () => ({ zipPath: 'test.zip' })),
}));
vi.mock('../../../src/bundle/extractor.js', () => ({ extractBundle: vi.fn() }));
import { downloadBundle } from '../../../src/bundle/downloader.js';
import { extractBundle } from '../../../src/bundle/extractor.js';

const root = 'https://skills.example.com/catalogue';
const pinFor = (named: boolean) => buildSourcePin({ type: 'bundle', baseUrl: root, ...(named ? { sourceName: 'team', installLayout: 'namespaced' as const } : { installLayout: 'flat' as const }) }, '1.0.0');
async function bundle(pin: SkillSourcePin, version: string, contentRoot = root) {
  const dir = bundleDirectoryForPin(pin, version);
  await fs.mkdir(path.join(dir, 'skill'), { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version, published: '2026-01-01' }));
  await fs.writeFile(path.join(dir, '.source.json'), JSON.stringify({ contentRoot, trackedReferences: true }));
  await fs.writeFile(path.join(dir, 'skill', 'SKILL.md'), `# Skill ${version}`);
  return dir;
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'agentman-version-'));
  vi.mocked(getPlatform).mockReturnValue('linux');
});
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(home, { recursive: true, force: true }); });

describe('source-preserving version round trips', () => {
  it.each([
    { named: false, scope: 'system' as const }, { named: true, scope: 'system' as const },
    { named: false, scope: 'repo' as const }, { named: true, scope: 'repo' as const },
  ])('install -> switch -> reload -> info -> update ($scope, namespaced=$named)', async ({ named, scope }) => {
    const pin = pinFor(named);
    const first = await bundle(pin, '1.0.0');
    const second = await bundle(pin, '2.0.0');
    const repoRoot = path.join(home, 'repo');
    await fs.mkdir(repoRoot);
    const provisioner = createSkillProvisioner('claude-code', scope, scope === 'repo' ? repoRoot : undefined);
    const installed = await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
    expect(installed.errors).toEqual([]);
    const key = installed.installed[0].name;
    const instance = { installKey: key, toolId: 'claude-code', scope, ...(scope === 'repo' ? { repoRoot } : {}) };
    const choices = await listInstalledSkillVersions(instance);
    expect(choices.unsupportedReason).toBeUndefined();
    await switchInstalledSkillVersion(instance, choices.versions.find((v) => v.version === '2.0.0')!.bundleId);
    const config = scope === 'repo' ? await readRepoConfig(repoRoot) : await readConfig();
    expect(config!.installations['claude-code'][key]).toMatchObject({ sourcePin: { ...pin, bundleVersion: '2.0.0' }, bundleVersion: '2.0.0', method: 'symlink' });
    expect(await fs.realpath(installed.installed[0].path)).toBe(path.join(second, 'skill'));
    expect((await provisioner.getInstalled())[0].bundleVersion).toBe('2.0.0');
    expect((await listInstalled(scope, { repoRoot }))[0].version).toBe('2.0.0');
    vi.mocked(extractBundle).mockResolvedValue({ manifest: { version: '2.0.0', published: '2026-01-01' }, bundleDir: second, isNew: false });
    await updateInstalled(key, scope, 'claude-code', undefined, { repoRoot });
    expect(downloadBundle).toHaveBeenLastCalledWith(root, undefined, undefined, named ? 'team' : undefined);
    expect((scope === 'repo' ? await readRepoConfig(repoRoot) : await readConfig())!.installations['claude-code'][key].sourcePin).toEqual({ ...pin, bundleVersion: '2.0.0' });
  });

  it('records the actual Windows copy fallback and preserves the source pin', async () => {
    const pin = pinFor(true);
    const first = await bundle(pin, '1.0.0');
    await bundle(pin, '2.0.0');
    const provisioner = createSkillProvisioner('claude-code');
    const installed = await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
    vi.mocked(getPlatform).mockReturnValue('windows');
    vi.spyOn(fs, 'symlink').mockRejectedValue(Object.assign(new Error('No privilege'), { code: 'EPERM' }));
    expect(await updateSkillVersion('claude-code', installed.installed[0].name, '2.0.0')).toEqual({ success: true });
    const record = (await readConfig()).installations['claude-code'][installed.installed[0].name];
    expect(record.method).toBe('copy');
    expect(record.sourcePin?.bundleVersion).toBe('2.0.0');
    expect((await fs.lstat(installed.installed[0].path)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(installed.installed[0].path, 'SKILL.md'), 'utf8')).toContain('2.0.0');
  });

  it('restores the old install when record publication fails', async () => {
    const pin = pinFor(false);
    const first = await bundle(pin, '1.0.0');
    await bundle(pin, '2.0.0');
    const provisioner = createSkillProvisioner('claude-code');
    const installed = await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
    const rename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).endsWith('config.json')) throw new Error('Disk error');
      return rename(from, to);
    });
    expect(await updateSkillVersion('claude-code', 'skill', '2.0.0')).toMatchObject({ success: false, error: 'Disk error' });
    expect(await fs.realpath(installed.installed[0].path)).toBe(path.join(first, 'skill'));
    expect((await readConfig()).installations['claude-code'].skill.sourcePin?.bundleVersion).toBe('1.0.0');
  });

  it.each(['repo', 'artefact', 'missing', 'local'])('rejects unsupported %s records before touching their links', async (kind) => {
    await recordInstall('claude-code', 'skill', { installedAt: '', method: 'copy', sourcePin: kind === 'missing' ? undefined : { sourceType: kind === 'local' ? 'bundle' : kind as 'repo' | 'artefact' } });
    expect(await updateSkillVersion('claude-code', 'skill', '2.0.0')).toMatchObject({ success: false, statusCode: 409 });
    const choices = await listInstalledSkillVersions({ installKey: 'skill', toolId: 'claude-code', scope: 'system' });
    expect(choices.versions).toEqual([]);
    expect(choices.unsupportedReason).toBeTruthy();
  });

  it('cannot substitute an equal version label from another origin, even with its valid ID', async () => {
    const pin = pinFor(false);
    const first = await bundle(pin, '1.0.0');
    const alien = await bundle(pin, '2.0.0', 'https://other.example.com/catalogue');
    const provisioner = createSkillProvisioner('claude-code');
    const installed = await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
    const instance = { installKey: 'skill', toolId: 'claude-code', scope: 'system' as const };
    expect((await listInstalledSkillVersions(instance)).versions.map((v) => v.version)).toEqual(['1.0.0']);
    await expect(switchInstalledSkillVersion(instance, (await readBundleIdentity(alien)).bundleId)).rejects.toMatchObject({ statusCode: 409 });
    expect(await updateSkillVersion('claude-code', 'skill', '2.0.0')).toMatchObject({ success: false, statusCode: 409 });
    expect(await fs.realpath(installed.installed[0].path)).toBe(path.join(first, 'skill'));
  });

  it('rejects traversal and cache symlink escapes before changing current', async () => {
    const pin = pinFor(false);
    await bundle(pin, '1.0.0');
    await setCurrentBundle('1.0.0');
    await expect(setCurrentBundle('../outside')).rejects.toThrow();
    await fs.mkdir(path.join(home, 'outside'));
    await fs.symlink(path.join(home, 'outside'), bundleDirectoryForPin(pin, '2.0.0'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(setCurrentBundle('2.0.0')).rejects.toMatchObject({ statusCode: 409 });
    expect(await getCurrentBundleVersion()).toBe('1.0.0');
  });

  it('protects current and repo references, and permits deletion after removal', async () => {
    const pin = pinFor(false);
    const first = await bundle(pin, '1.0.0');
    const second = await bundle(pin, '2.0.0');
    await setCurrentBundle('1.0.0');
    await expect(removeCachedBundle('1.0.0')).rejects.toMatchObject({ statusCode: 409 });
    const repoRoot = path.join(home, 'elsewhere');
    await fs.mkdir(repoRoot);
    const provisioner = createSkillProvisioner('claude-code', 'repo', repoRoot);
    await provisioner.install((await scanBundle(second)).skills, '2.0.0', { ...pin, bundleVersion: '2.0.0' });
    await expect(removeCachedBundle('2.0.0')).rejects.toMatchObject({ statusCode: 409 });
    await provisioner.uninstall(['skill']);
    await removeCachedBundle('2.0.0');
    await expect(fs.stat(second)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(first)).isDirectory()).toBe(true);
  });
});

it('uses distinct opaque IDs for equal labels from different named sources and revalidates them', async () => {
  const { listBundles, removeBundle } = await import('../../../src/operations/versions.js');
  const a = pinFor(true);
  const b = { ...a, bundleSourceName: 'other', bundleBaseUrl: 'https://other.example.com/catalogue' };
  const first = await bundle(a, '1.0.0');
  const second = await bundle(b, '1.0.0', b.bundleBaseUrl);
  const choices = await listBundles();
  expect(choices).toHaveLength(2);
  expect(new Set(choices.map((item) => item.bundleId)).size).toBe(2);
  const firstId = choices.find((item) => item.bundleDir === first)!.bundleId!;
  await fs.writeFile(path.join(first, '.source.json'), JSON.stringify({ contentRoot: 'https://changed.example.com/catalogue', trackedReferences: true }));
  await expect(removeBundle(firstId)).rejects.toMatchObject({ statusCode: 409 });
  await removeBundle(choices.find((item) => item.bundleDir === second)!.bundleId!);
  await expect(fs.stat(second)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fs.stat(first)).isDirectory()).toBe(true);
});

it('does not change the active source when switching a global version', async () => {
  const { switchBundleVersion } = await import('../../../src/operations/versions.js');
  const pin = pinFor(false);
  await bundle(pin, '1.0.0');
  await bundle(pin, '2.0.0', 'https://other.example.com/catalogue');
  await setCurrentBundle('1.0.0');
  await expect(switchBundleVersion({ version: '2.0.0', syncInstalled: false })).rejects.toMatchObject({ statusCode: 409 });
  expect(await getCurrentBundleVersion()).toBe('1.0.0');
});

it('keeps the current bundle when publishing its replacement fails', async () => {
  const pin = pinFor(false);
  await bundle(pin, '1.0.0'); await bundle(pin, '2.0.0');
  await setCurrentBundle('1.0.0');
  const rename = fs.rename;
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(from).includes('current.stage-')) throw new Error('Publish failed');
    return rename(from, to);
  });
  await expect(setCurrentBundle('2.0.0')).rejects.toThrow('Publish failed');
  expect(await getCurrentBundleVersion()).toBe('1.0.0');
});

it('rejects a manifest whose version differs from its directory name', async () => {
  const dir = await bundle(pinFor(false), '1.0.0');
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version: '2.0.0', published: '2026-01-01' }));
  await expect(readBundleIdentity(dir)).rejects.toMatchObject({ statusCode: 409 });
});

it('reports an uninstalled record and an unknown tool without filesystem writes', async () => {
  expect(await updateSkillVersion('claude-code', 'missing', '2.0.0')).toMatchObject({ success: false, error: expect.stringContaining('not installed') });
  await recordInstall('unknown-tool', 'skill', { installedAt: '', method: 'symlink', sourcePin: pinFor(false) });
  expect(await updateSkillVersion('unknown-tool', 'skill', '2.0.0')).toMatchObject({ success: false, error: expect.stringContaining('Unknown tool') });
});

it('reports a missing skill in an otherwise valid target bundle', async () => {
  const pin = pinFor(false);
  const first = await bundle(pin, '1.0.0');
  const second = await bundle(pin, '2.0.0');
  await fs.rm(path.join(second, 'skill'), { recursive: true });
  const provisioner = createSkillProvisioner('claude-code');
  await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
  expect(await updateSkillVersion('claude-code', 'skill', '2.0.0')).toMatchObject({ success: false, error: expect.stringContaining('does not exist in version') });
});

it('switching a repository instance leaves sibling records and its legacy top-level version untouched', async () => {
  const pin = pinFor(false);
  const first = await bundle(pin, '1.0.0'); await bundle(pin, '2.0.0');
  const repoRoot = path.join(home, 'repo'); await fs.mkdir(repoRoot);
  const provisioner = createSkillProvisioner('claude-code', 'repo', repoRoot);
  await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
  const { recordRepoInstall } = await import('../../../src/bundle/repo-config.js');
  await recordRepoInstall(repoRoot, 'cursor', 'sibling', { installedAt: 'old', method: 'copy', sourcePin: pin }, '1.0.0');
  const before = await readRepoConfig(repoRoot);
  expect(await updateSkillVersion('claude-code', 'skill', '2.0.0', { scope: 'repo', repoRoot })).toEqual({ success: true });
  const after = await readRepoConfig(repoRoot);
  expect(after?.installations.cursor).toEqual(before?.installations.cursor);
  expect(after?.bundleVersion).toBe(before?.bundleVersion);
});

it('a deleted repository config does not permanently block cache cleanup', async () => {
  const pin = pinFor(false);
  const first = await bundle(pin, '1.0.0');
  const repoRoot = path.join(home, 'repo'); await fs.mkdir(repoRoot);
  await createSkillProvisioner('claude-code', 'repo', repoRoot).install((await scanBundle(first)).skills, '1.0.0', pin);
  await fs.rm(path.join(repoRoot, '.agentman.json'));
  await expect(removeCachedBundle('1.0.0')).resolves.toBeUndefined();
});

it('does not block deletion for an equal version in a different source cache', async () => {
  const { removeBundle } = await import('../../../src/operations/versions.js');
  const a = pinFor(true);
  const b = { ...a, bundleSourceName: 'other' };
  const first = await bundle(a, '1.0.0');
  const second = await bundle(b, '1.0.0');
  await createSkillProvisioner('claude-code').install((await scanBundle(first)).skills, '1.0.0', a);
  await removeBundle((await readBundleIdentity(second)).bundleId);
  expect((await fs.stat(first)).isDirectory()).toBe(true);
});

it.each([false, true])('rolls back a repository install when registration fails (reinstall=%s)', async (reinstall) => {
  const pin = pinFor(false);
  const first = await bundle(pin, '1.0.0'); const second = await bundle(pin, '2.0.0');
  const repoRoot = path.join(home, 'repo'); await fs.mkdir(repoRoot);
  const provisioner = createSkillProvisioner('claude-code', 'repo', repoRoot);
  if (reinstall) await provisioner.install((await scanBundle(first)).skills, '1.0.0', pin);
  await fs.writeFile(path.join(home, '.agentman', 'repositories.json'), '{');
  const result = await provisioner.install((await scanBundle(second)).skills, '2.0.0', { ...pin, bundleVersion: '2.0.0' });
  expect(result.installed).toEqual([]);
  expect(result.errors).toHaveLength(1);
  const destination = path.join(provisioner.getEffectiveSkillsDir(), 'skill');
  if (reinstall) {
    expect(await fs.realpath(destination)).toBe(path.join(first, 'skill'));
    expect((await readRepoConfig(repoRoot))!.installations['claude-code'].skill.sourcePin?.bundleVersion).toBe('1.0.0');
  } else {
    await expect(fs.lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readRepoConfig(repoRoot)).toBeNull();
  }
  expect((await fs.readdir(provisioner.getEffectiveSkillsDir())).some((name) => name.includes('.stage-') || name.includes('.backup-'))).toBe(false);
});
