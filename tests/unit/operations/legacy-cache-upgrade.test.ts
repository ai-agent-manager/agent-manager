import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import extractZip from 'extract-zip';
import { acquireBundle, loadSession } from '../../../src/operations/session.js';
import { downloadBundleVersion, listBundles, listInstalledSkillVersions, switchBundleVersion, switchInstalledSkillVersion } from '../../../src/operations/versions.js';
import { updateInstalled, removeInstalled } from '../../../src/operations/manage.js';
import { runHeadless } from '../../../src/headless.js';
import { importLocalBundle } from '../../../src/bundle/importer.js';
import { readConfig, removeCachedBundle, setCurrentBundle } from '../../../src/bundle/cache.js';
import { withMutation } from '../../../src/lib/mutation.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { buildPinForDirectorySource } from '../../../src/bundle/skill-source.js';
import { createSkillProvisioner } from '../../../src/provisioners/registry.js';

let home: string;
let cache: string;
let archive: Buffer;
const root = 'https://skills.example.com/agents';
const source = { type: 'url' as const, baseUrl: root };
const version = '0.1.1';
const skill = 'react-component-generator';
vi.mock('../../../src/lib/platform.js', async (original) => ({ ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => home }));

beforeEach(async () => {
  home = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-upgrade-'));
  cache = path.join(home, '.agentman', 'bundles', version);
  await mkdir(cache, { recursive: true });
  const zip = path.resolve('mocks/agents/0.1.1/bundle.zip');
  archive = await readFile(zip);
  // The release's flat extractor publishes the archive unchanged and writes no
  // .source.json. Use real archive extraction, not a mocked modern extractor.
  await extractZip(zip, { dir: cache });
  await mkdir(path.join(home, '.claude', 'skills'), { recursive: true });
  await symlink(path.join(cache, skill), path.join(home, '.claude', 'skills', skill), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(cache, path.join(home, '.agentman', 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(home, '.agentman', 'config.json'), JSON.stringify({ baseUrl: root, installations: { 'claude-code': { [skill]: {
    bundleVersion: version, installedAt: '2026-01-01', method: 'symlink', sourcePin: {
      sourceType: 'bundle', installLayout: 'flat', bundleVersion: version, bundleBaseUrl: root, bundleAddressing: 'content-root',
    },
  } } } }));
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input);
    if (url === `${root}/index.json`) return new Response(JSON.stringify({ lastUpdated: '2026-01-01', agents: [{ version, published: '2026-01-01' }] }));
    if (url.endsWith('/bundle.zip.sha256')) return new Response(createHash('sha256').update(archive).digest('hex'));
    if (url.endsWith('/bundle.zip')) return new Response(new Uint8Array(archive));
    return new Response('', { status: 404 });
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await rm(home, { recursive: true, force: true }); });

it.each(['startup-update', 'check-updates', 'headless', 'manage-update'])('adopts an old flat cache through %s when latest has not changed', async (entry) => {
  if (entry === 'startup-update') await loadSession({ source }, { forceUpdate: true });
  if (entry === 'check-updates') await downloadBundleVersion(source, version);
  if (entry === 'headless') {
    const config = path.join(home, 'headless.json');
    await writeFile(config, JSON.stringify({ tools: ['claude-code'], scope: 'system', skills: [skill] }));
    await runHeadless(root, config, false);
  }
  if (entry === 'manage-update') expect((await updateInstalled(skill, 'system', 'claude-code')).errors).toEqual([]);
  expect(JSON.parse(await readFile(path.join(cache, '.source.json'), 'utf8'))).toEqual({ contentRoot: root, trackedReferences: false });
  expect(await realpath(path.join(home, '.claude', 'skills', skill))).toBe(path.join(cache, skill));
  expect((await readConfig()).installations['claude-code'][skill].sourcePin?.bundleVersion).toBe(version);
  expect((await readdir(path.join(home, '.agentman', 'tmp'))).filter((name) => name.endsWith('.zip'))).toEqual([]);
});

it('can move away from an unattested active version to an attested version', async () => {
  const next = path.join(home, '.agentman', 'bundles', '0.1.2');
  await cp(cache, next, { recursive: true });
  await writeFile(path.join(next, 'manifest.json'), JSON.stringify({ version: '0.1.2', published: '2026-01-02' }));
  await writeFile(path.join(next, '.source.json'), JSON.stringify({ contentRoot: root }));
  await expect(switchBundleVersion({ version: '0.1.2', syncInstalled: false })).resolves.toEqual({ failures: [] });
  await acquireBundle(source, () => {});
  await expect(switchBundleVersion({ version, syncInstalled: false })).resolves.toEqual({ failures: [] });
});

it('permits cleanup of an unused legacy cache but protects recorded installs', async () => {
  const unused = path.join(home, '.agentman', 'bundles', 'unused');
  await mkdir(unused);
  await removeCachedBundle('unused');
  await setCurrentBundle(version);
  await expect(removeCachedBundle(version)).rejects.toMatchObject({ statusCode: 409 });
  const other = path.join(home, '.agentman', 'bundles', 'other');
  await mkdir(other); await setCurrentBundle('other');
  await expect(removeCachedBundle(version)).rejects.toThrow('referenced');
  await removeInstalled(skill, 'system', 'claude-code');
  await removeCachedBundle(version);
});

it('adopts old directory caches and supports their identities and per-skill switches', async () => {
  const directory = path.join(home, 'source');
  await cp(cache, directory, { recursive: true });
  const session = await loadSession({ source: { type: 'directory', dirPath: directory } });
  expect(session.bundleContents?.skills.some((item) => item.dirName === skill)).toBe(true);
  const first = (await listBundles()).find((entry) => entry.version === version)!;
  expect(first.bundleId).toBeTruthy();
  expect(first.unsupportedReason).toBeUndefined();
  const provisioner = createSkillProvisioner('cursor');
  await provisioner.install((await scanBundle(cache)).skills, version, buildPinForDirectorySource(directory, version));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: '0.1.2', published: '2026-01-02' }));
  const next = await importLocalBundle(directory);
  const instance = { installKey: skill, toolId: 'cursor', scope: 'system' as const };
  const choices = await listInstalledSkillVersions(instance);
  expect(choices.unsupportedReason).toBeUndefined();
  await switchInstalledSkillVersion(instance, choices.versions.find((entry) => entry.version === '0.1.2')!.bundleId);
  expect(await realpath(path.join(provisioner.getEffectiveSkillsDir(), skill))).toBe(path.join(next.bundleDir, skill));
});

it('does not invent provenance when legacy content differs from the downloaded source', async () => {
  await writeFile(path.join(cache, skill, 'SKILL.md'), 'unrelated publisher content');
  await expect(acquireBundle(source, () => {})).rejects.toThrow('differs from the selected source');
  await expect(readFile(path.join(cache, '.source.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('allows reads and another mutation while a download is stalled', async () => {
  const original = fetch;
  let started!: () => void; let resume!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    if (String(input).endsWith('/bundle.zip')) { started(); await release; }
    return original(input, init);
  }));
  const running = downloadBundleVersion(source, version);
  await entered;
  try {
    await expect(listBundles()).resolves.toHaveLength(1);
    await expect(withMutation(async () => 'entered', { timeoutMs: 0 })).resolves.toBe('entered');
  } finally { resume(); await running; }
});

it('does not reinstall a skill removed while its update waits for authentication', async () => {
  let started!: () => void; let resume!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  const running = updateInstalled(skill, 'system', 'claude-code', async () => { started(); await release; return undefined; });
  const rejected = expect(running).rejects.toThrow();
  await entered;
  try { await removeInstalled(skill, 'system', 'claude-code'); }
  finally { resume(); }
  await rejected;
  expect((await readConfig()).installations['claude-code'][skill]).toBeUndefined();
});

it('verifies a moved directory against cached content and keeps old and new pins valid', async () => {
  const directory = path.join(home, 'source');
  const moved = path.join(home, 'moved');
  await cp(cache, directory, { recursive: true });
  await importLocalBundle(directory);
  const originalPin = buildPinForDirectorySource(directory, version);
  await cp(directory, moved, { recursive: true });
  await rm(directory, { recursive: true });
  await expect(loadSession({ source: { type: 'directory', dirPath: moved } })).resolves.toMatchObject({ manifest: { version } });
  const { resolvePinnedBundle } = await import('../../../src/bundle/version-identity.js');
  const original = await resolvePinnedBundle(originalPin, version);
  const relocated = await resolvePinnedBundle(buildPinForDirectorySource(moved, version), version);
  expect(relocated.bundleId).toBe(original.bundleId);
  expect(relocated.directoryAliases).toContain(await realpath(moved));
});

it('rejects a different directory with the same version but different content, without changing provenance', async () => {
  const directory = path.join(home, 'source');
  const other = path.join(home, 'other');
  await cp(cache, directory, { recursive: true });
  await importLocalBundle(directory);
  const before = await readFile(path.join(cache, '.source.json'), 'utf8');
  await cp(directory, other, { recursive: true });
  await writeFile(path.join(other, skill, 'SKILL.md'), 'Different content');
  await expect(importLocalBundle(other)).rejects.toThrow(`Cached version ${version} differs`);
  expect(await readFile(path.join(cache, '.source.json'), 'utf8')).toBe(before);
});
