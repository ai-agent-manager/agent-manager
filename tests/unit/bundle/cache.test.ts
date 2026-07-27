import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, lstat, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { vi } from 'vitest';

// Mock scanner module
vi.mock('../../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(),
}));

// Mock platform module
vi.mock('../../../src/lib/platform.js', () => ({
  getHomeDir: vi.fn(() => '/mock/home'),
  getPlatform: vi.fn(() => 'macos'),
}));

// We need to mock the paths module so cache.ts writes to a temp dir instead of ~/.agentman
let tempDir: string;

vi.mock('../../../src/config/paths.js', () => ({
  getAgentmanDir: () => tempDir,
  getBundlesDir: () => path.join(tempDir, 'bundles'),
  getBundleVersionDir: (v: string) => path.join(tempDir, 'bundles', v),
  getCurrentBundleLink: () => path.join(tempDir, 'current'),
  getConfigPath: () => path.join(tempDir, 'config.json'),
  getConfigLockPath: () => path.join(tempDir, 'config.json.lock'),
}));

// Mock fs operations for updateSkillVersion tests
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readlink: vi.fn(actual.readlink),
    unlink: vi.fn(actual.unlink),
    symlink: vi.fn(actual.symlink),
  };
});

import {
  readConfig,
  writeConfig,
  recordInstall,
  removeInstallRecord,
  setCurrentBundle,
  updateSkillVersion,
  getRecordVersion,
  addSource,
  removeSource,
  setActiveSource,
  classifyStoredSource,
  orderedSources,
  type AgentmanConfig,
} from '../../../src/bundle/cache.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { getPlatform } from '../../../src/lib/platform.js';
import { readRepoConfig, writeRepoConfig, type RepoAgentmanConfig } from '../../../src/bundle/repo-config.js';

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-cache-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('stored sources', () => {
  it('classifies URLs as discovery and paths as directory', () => {
    expect(classifyStoredSource('https://bootstrap.example.com')).toEqual({
      kind: 'discovery',
      value: 'https://bootstrap.example.com',
    });
    expect(classifyStoredSource('./my-agents')).toEqual({ kind: 'directory', value: './my-agents' });
  });

  it('migrates a legacy baseUrl-only config into sources + activeSource on read', async () => {
    await writeFile(path.join(tempDir, 'config.json'), JSON.stringify({ baseUrl: 'https://legacy.example.com', installations: {} }));

    const config = await readConfig();

    expect(config.sources).toEqual([{ kind: 'discovery', value: 'https://legacy.example.com' }]);
    expect(config.activeSource).toEqual({ kind: 'discovery', value: 'https://legacy.example.com' });
  });

  it('does not re-seed sources when they already exist', async () => {
    await writeFile(
      path.join(tempDir, 'config.json'),
      JSON.stringify({ baseUrl: 'https://legacy.example.com', sources: [], installations: {} }),
    );

    const config = await readConfig();
    expect(config.sources).toEqual([]);
  });

  it('adds a source idempotently and sets it active', async () => {
    const src = { kind: 'discovery' as const, value: 'https://a.example.com' };
    await addSource(src, { setActive: true });
    await addSource(src, { setActive: true });

    const config = await readConfig();
    expect(config.sources).toEqual([src]);
    expect(config.activeSource).toEqual(src);
  });

  it('orders sources with the active one first', async () => {
    const a = { kind: 'discovery' as const, value: 'https://a.example.com' };
    const b = { kind: 'directory' as const, value: './b' };
    await addSource(a);
    await addSource(b, { setActive: true });

    const config = await readConfig();
    expect(orderedSources(config)).toEqual([b, a]);
  });

  it('removes a source and repoints the active pointer to a remaining source', async () => {
    const a = { kind: 'discovery' as const, value: 'https://a.example.com' };
    const b = { kind: 'directory' as const, value: './b' };
    await addSource(a, { setActive: true });
    await addSource(b);

    await removeSource(a);

    const config = await readConfig();
    expect(config.sources).toEqual([b]);
    expect(config.activeSource).toEqual(b);
  });

  it('setActiveSource adds the source if it is not already known', async () => {
    const a = { kind: 'discovery' as const, value: 'https://a.example.com' };
    await setActiveSource(a);

    const config = await readConfig();
    expect(config.sources).toEqual([a]);
    expect(config.activeSource).toEqual(a);
  });
});

describe('readConfig', () => {
  it('returns default config when no config file exists', async () => {
    const config = await readConfig();
    expect(config).toEqual({ installations: {} });
  });

  it('reads an existing config file', async () => {
    const existing: AgentmanConfig = {
      baseUrl: 'https://example.com',
      installations: {
        'claude-code': {
          'my-skill': {
            bundleVersion: 'abc123',
            installedAt: '2025-01-01T00:00:00Z',
            method: 'symlink',
          },
        },
      },
    };
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'config.json'), JSON.stringify(existing));

    const config = await readConfig();
    expect(config.baseUrl).toBe('https://example.com');
    expect(config.installations['claude-code']['my-skill'].bundleVersion).toBe('abc123');
  });

  it('returns default config when config file has invalid JSON', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'config.json'), 'not valid json{{{');

    const config = await readConfig();
    expect(config).toEqual({ installations: {} });
  });

  it('backs up a corrupt config file instead of discarding it', async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, 'config.json'), 'not valid json{{{');

    await readConfig();

    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(tempDir);
    const backups = entries.filter((e) => e.startsWith('config.json.corrupt-'));
    expect(backups).toHaveLength(1);

    const backupContents = await readFile(path.join(tempDir, backups[0]), 'utf-8');
    expect(backupContents).toBe('not valid json{{{');
  });

  it('rethrows non-parse read errors (e.g. permission denied)', async () => {
    const { chmod } = await import('node:fs/promises');
    const configPath = path.join(tempDir, 'config.json');
    await mkdir(tempDir, { recursive: true });
    await writeFile(configPath, JSON.stringify({ installations: {} }));
    await chmod(configPath, 0o000);

    try {
      await expect(readConfig()).rejects.toThrow();
    } finally {
      await chmod(configPath, 0o644);
    }
  });
});

describe('writeConfig', () => {
  it('writes config to disk as formatted JSON', async () => {
    const config: AgentmanConfig = {
      baseUrl: 'https://test.com',
      installations: {},
    };
    await writeConfig(config);

    const raw = await readFile(path.join(tempDir, 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.baseUrl).toBe('https://test.com');
    expect(parsed.installations).toEqual({});
  });

  it('creates the agentman directory if it does not exist', async () => {
    // Remove tempDir so writeConfig has to create it
    await rm(tempDir, { recursive: true, force: true });

    const config: AgentmanConfig = { installations: {} };
    await writeConfig(config);

    const raw = await readFile(path.join(tempDir, 'config.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ installations: {}, schemaVersion: 2 });
  });

  it('leaves no temp files behind after writing', async () => {
    await writeConfig({ installations: {} });

    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(tempDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});

describe('recordInstall', () => {
  it('adds an install record to an empty config', async () => {
    await recordInstall('claude-code', 'my-skill', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });

    const config = await readConfig();
    expect(config.installations['claude-code']['my-skill']).toEqual({
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });
  });

  it('adds multiple skills under the same tool', async () => {
    await recordInstall('claude-code', 'skill-a', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });
    await recordInstall('claude-code', 'skill-b', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T01:00:00Z',
      method: 'copy',
    });

    const config = await readConfig();
    expect(Object.keys(config.installations['claude-code'])).toHaveLength(2);
    expect(config.installations['claude-code']['skill-a'].method).toBe('symlink');
    expect(config.installations['claude-code']['skill-b'].method).toBe('copy');
  });

  it('serializes concurrent writes so neither is lost (locking prevents clobbering)', async () => {
    // Two "processes" recording different skills at the same time — without the
    // lock around read-modify-write, whichever writes last would win with a
    // config it read before the other's write, silently dropping one record.
    await Promise.all([
      recordInstall('claude-code', 'skill-a', {
        bundleVersion: 'v1',
        installedAt: '2025-06-01T00:00:00Z',
        method: 'symlink',
      }),
      recordInstall('claude-code', 'skill-b', {
        bundleVersion: 'v1',
        installedAt: '2025-06-01T00:00:00Z',
        method: 'symlink',
      }),
    ]);

    const config = await readConfig();
    expect(config.installations['claude-code']['skill-a']).toBeDefined();
    expect(config.installations['claude-code']['skill-b']).toBeDefined();
  });

  it('adds skills under different tools', async () => {
    await recordInstall('claude-code', 'skill-a', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });
    await recordInstall('windsurf', 'skill-a', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });

    const config = await readConfig();
    expect(config.installations['claude-code']).toBeDefined();
    expect(config.installations['windsurf']).toBeDefined();
  });

  it('overwrites an existing record for the same tool/skill', async () => {
    await recordInstall('claude-code', 'my-skill', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });
    await recordInstall('claude-code', 'my-skill', {
      bundleVersion: 'v2',
      installedAt: '2025-06-02T00:00:00Z',
      method: 'symlink',
    });

    const config = await readConfig();
    expect(config.installations['claude-code']['my-skill'].bundleVersion).toBe('v2');
  });
});

describe('removeInstallRecord', () => {
  it('removes a specific skill record', async () => {
    await recordInstall('claude-code', 'skill-a', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });
    await recordInstall('claude-code', 'skill-b', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });

    await removeInstallRecord('claude-code', 'skill-a');

    const config = await readConfig();
    expect(config.installations['claude-code']['skill-a']).toBeUndefined();
    expect(config.installations['claude-code']['skill-b']).toBeDefined();
  });

  it('is a no-op when removing from a non-existent tool', async () => {
    await removeInstallRecord('non-existent-tool', 'some-skill');
    const config = await readConfig();
    expect(config.installations).toEqual({});
  });

  it('is a no-op when removing a non-existent skill', async () => {
    await recordInstall('claude-code', 'skill-a', {
      bundleVersion: 'v1',
      installedAt: '2025-06-01T00:00:00Z',
      method: 'symlink',
    });

    await removeInstallRecord('claude-code', 'non-existent-skill');

    const config = await readConfig();
    expect(config.installations['claude-code']['skill-a']).toBeDefined();
  });
});

describe('updateSkillVersion', () => {
  it('updates skill symlink to new bundle version', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    // Setup: skill installed from v1.0.0
    await recordInstall('claude-code', 'test-skill', {
      bundleVersion: '1.0.0',
      installedAt: '2026-04-03T10:00:00Z',
      method: 'symlink',
    });

    const newTarget = path.join(tempDir, 'bundles', '2.0.0', 'test-skill');

    // Mock: skill exists in target version
    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: 'test-skill', dirPath: newTarget, meta: null }],
      rovoAgents: [],
    } as any);

    // Mock: lstat succeeds for the removal block — skill exists as a non-directory
    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => false } as any);

    // Mock: unlink and symlink must not touch the real filesystem
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(symlink).mockResolvedValue(undefined);

    const result = await updateSkillVersion('claude-code', 'test-skill', '2.0.0');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify symlink was created pointing to the correct new bundle path
    // getPlatform() is mocked to 'macos', so replaceSymlink uses 'dir'
    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      newTarget,
      expect.stringContaining('test-skill'),
      'dir',
    );

    // Verify config was updated: new version recorded, original installedAt preserved
    const config = await readConfig();
    const record = config.installations['claude-code']['test-skill'];
    expect(record.bundleVersion).toBe('2.0.0');
    expect(record.installedAt).toBe('2026-04-03T10:00:00Z');
  });

  it('returns error when skill does not exist in target version', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    await recordInstall('claude-code', 'test-skill', {
      bundleVersion: '1.0.0',
      installedAt: '2026-04-03T10:00:00Z',
      method: 'symlink',
    });

    // Mock: skill NOT in target bundle
    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: 'other-skill', dirPath: '/path', meta: null }],
      rovoAgents: [],
    } as any);

    const result = await updateSkillVersion('claude-code', 'test-skill', '2.0.0');

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist in version 2.0.0');
  });

  it('returns error when skill is not installed', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    // No skills installed
    await writeConfig({ installations: {} });

    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: 'test-skill', dirPath: '/path', meta: null }],
      rovoAgents: [],
    } as any);

    const result = await updateSkillVersion('claude-code', 'test-skill', '2.0.0');

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not installed');
  });

  it('returns error when bundle version cannot be accessed', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    await recordInstall('claude-code', 'test-skill', {
      bundleVersion: '1.0.0',
      installedAt: '2026-04-03T10:00:00Z',
      method: 'symlink',
    });

    // Mock: bundle scan fails
    vi.mocked(scanBundle).mockRejectedValue(new Error('Bundle not found'));

    const result = await updateSkillVersion('claude-code', 'test-skill', '2.0.0');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot access bundle version');
  });

  it('handles symlink creation failure gracefully', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    await recordInstall('claude-code', 'test-skill', {
      bundleVersion: '1.0.0',
      installedAt: '2026-04-03T10:00:00Z',
      method: 'symlink',
    });

    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: 'test-skill', dirPath: '/path', meta: null }],
      rovoAgents: [],
    } as any);

    // Mock: symlink creation fails
    vi.mocked(symlink).mockRejectedValue(new Error('Permission denied'));

    const result = await updateSkillVersion('claude-code', 'test-skill', '2.0.0');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('returns error for unknown tool', async () => {
    const { updateSkillVersion } = await import('../../../src/bundle/cache.js');

    await recordInstall('unknown-tool', 'test-skill', {
      bundleVersion: '1.0.0',
      installedAt: '2026-04-03T10:00:00Z',
      method: 'symlink',
    });

    vi.mocked(scanBundle).mockResolvedValue({
      skills: [{ dirName: 'test-skill', dirPath: '/path', meta: null }],
      rovoAgents: [],
    } as any);

    const result = await updateSkillVersion('unknown-tool', 'test-skill', '2.0.0');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

});

describe('updateSkillVersion (repo scope)', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-repo-test-'));
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it('updates only the targeted skill, leaving other skills unchanged', async () => {
    // Setup: two skills installed at repo scope on version 1.0.0
    const repoConfig: RepoAgentmanConfig = {
      bundleVersion: '1.0.0',
      installations: {
        'claude-code': {
          'skill-a': { bundleVersion: '1.0.0', installedAt: '2026-04-01T00:00:00Z', method: 'symlink' },
          'skill-b': { bundleVersion: '1.0.0', installedAt: '2026-04-01T00:00:00Z', method: 'symlink' },
        },
      },
    };
    await writeRepoConfig(repoDir, repoConfig);

    const newTarget = path.join(tempDir, 'bundles', '2.0.0', 'skill-a');

    // Mock: skill exists in target version
    vi.mocked(scanBundle).mockResolvedValue({
      skills: [
        { dirName: 'skill-a', dirPath: newTarget, meta: null },
        { dirName: 'skill-b', dirPath: '/path', meta: null },
      ],
      rovoAgents: [],
    } as any);

    vi.mocked(lstat).mockResolvedValue({ isDirectory: () => false } as any);
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(symlink).mockResolvedValue(undefined);

    const result = await updateSkillVersion('claude-code', 'skill-a', '2.0.0', {
      scope: 'repo',
      repoRoot: repoDir,
    });

    expect(result.success).toBe(true);

    // Verify: only skill-a was updated, skill-b stays on 1.0.0
    const updatedConfig = await readRepoConfig(repoDir);
    expect(updatedConfig!.installations['claude-code']['skill-a'].bundleVersion).toBe('2.0.0');
    expect(updatedConfig!.installations['claude-code']['skill-b'].bundleVersion).toBe('1.0.0');

    // Top-level bundleVersion should NOT be changed
    expect(updatedConfig!.bundleVersion).toBe('1.0.0');
  });
});

describe('setCurrentBundle', () => {
  it('passes dir type on non-Windows', async () => {
    vi.mocked(getPlatform).mockReturnValue('macos');
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(symlink).mockResolvedValue(undefined);

    await setCurrentBundle('1.2.0');

    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      path.join(tempDir, 'bundles', '1.2.0'),
      path.join(tempDir, 'current'),
      'dir',
    );
  });

  it('passes junction type on Windows', async () => {
    vi.mocked(getPlatform).mockReturnValue('windows');
    vi.mocked(unlink).mockResolvedValue(undefined);
    vi.mocked(symlink).mockResolvedValue(undefined);

    await setCurrentBundle('1.2.0');

    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      path.join(tempDir, 'bundles', '1.2.0'),
      path.join(tempDir, 'current'),
      'junction',
    );
  });
});

describe('getRecordVersion', () => {
  it('returns sourcePin.bundleVersion when pin is present', () => {
    const record = { bundleVersion: 'legacy', installedAt: '', method: 'symlink' as const, sourcePin: { sourceType: 'bundle' as const, installLayout: 'flat' as const, bundleVersion: '2026.07.01' } };
    expect(getRecordVersion(record)).toBe('2026.07.01');
  });

  it('returns bundleVersion when no sourcePin is present', () => {
    const record = { bundleVersion: '2026.06.01', installedAt: '', method: 'symlink' as const };
    expect(getRecordVersion(record)).toBe('2026.06.01');
  });

  it('returns empty string when sourcePin has no bundleVersion (repo/artefact shaped)', () => {
    const record = { installedAt: '', method: 'symlink' as const, sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const } };
    expect(getRecordVersion(record)).toBe('');
  });

  it('returns empty string when neither sourcePin nor bundleVersion is present', () => {
    const record = { installedAt: '', method: 'symlink' as const };
    expect(getRecordVersion(record)).toBe('');
  });
});
