vi.mock('../../../src/bundle/version-identity.js', () => ({ readBundleIdentity: vi.fn(async () => ({})), resolvePinnedBundle: vi.fn(async () => ({})) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBundleVersion, listRemoteVersions, listSkillVersionInstances, listVersionsContainingSkill, switchBundleVersion } from '../../../src/operations/versions.js';
import { getValidBearerToken } from '../../../src/auth/index.js';
import { downloadBundle, fetchIndex } from '../../../src/bundle/downloader.js';
import { setCurrentBundle, updateSkillVersion } from '../../../src/bundle/cache.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { listInstalled } from '../../../src/operations/manage.js';
import { OperationCancelledError } from '../../../src/operations/cancellation.js';

vi.mock('../../../src/auth/index.js', () => ({ getValidBearerToken: vi.fn() }));
vi.mock('../../../src/bundle/downloader.js', () => ({ downloadBundle: vi.fn(), fetchIndex: vi.fn() }));
vi.mock('../../../src/bundle/extractor.js', () => ({ extractBundle: vi.fn(async () => ({ isNew: true })) }));
vi.mock('../../../src/bundle/scanner.js', () => ({ scanBundle: vi.fn() }));
vi.mock('../../../src/bundle/cache.js', () => ({
  listCachedBundles: vi.fn(), getCurrentBundleVersion: vi.fn(), setCurrentBundle: vi.fn(), updateSkillVersion: vi.fn(),
}));
vi.mock('../../../src/operations/manage.js', () => ({ listInstalled: vi.fn() }));
vi.mock('../../../src/telemetry.js', () => ({ getBundleSourceTelemetryProperties: vi.fn(() => ({})), trackTelemetryError: vi.fn() }));

const source = { type: 'url' as const, baseUrl: 'https://skills.example.com/agents' };
const auth = { discoveryBaseUrl: 'https://skills.example.com', auth: {
  required: true, clientId: 'test-client', oidcDiscoveryUrl: 'https://auth.example.com/discovery',
} };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getValidBearerToken).mockResolvedValue('fresh-token');
  vi.mocked(downloadBundle).mockResolvedValue({ zipPath: 'test.zip', version: '2.0.0', sha256: null });
  vi.mocked(fetchIndex).mockResolvedValue({ lastUpdated: '2026-01-01', agents: [{ version: '2.0.0', published: '2026-01-01' }] });
});

describe('version operations', () => {
  it('refreshes auth for each remote operation without activating a downloaded bundle', async () => {
    expect(await listRemoteVersions(source, auth)).toHaveLength(1);
    await downloadBundleVersion(source, '2.0.0', auth);
    expect(getValidBearerToken).toHaveBeenCalledTimes(2);
    expect(fetchIndex).toHaveBeenCalledWith(source.baseUrl, 'fresh-token');
    expect(downloadBundle).toHaveBeenCalledWith(source.baseUrl, '2.0.0', 'fresh-token');
    expect(setCurrentBundle).not.toHaveBeenCalled();
  });

  it('keeps unreadable and missing-skill versions visible as unavailable', async () => {
    vi.mocked(scanBundle).mockResolvedValueOnce({
      skills: [{ dirName: 'wanted', dirPath: '/example/wanted', skillMdPath: '/example/wanted/SKILL.md' }], rovoAgents: [],
    });
    vi.mocked(scanBundle).mockRejectedValueOnce(new Error('Invalid manifest'));
    const versions = await listVersionsContainingSkill('wanted', [
      { version: '1.0.0', published: '2026-01-01', isCurrent: true, bundleDir: 'unused' },
      { version: '2.0.0', published: '2026-02-01', isCurrent: false, bundleDir: 'unused' },
    ]);
    expect(versions.map((version) => version.hasSkill)).toEqual([true, false]);
  });

  it('retains repository instance identity and reports partial sync failures', async () => {
    vi.mocked(listInstalled).mockResolvedValue([
      { installKey: 'example.com/source/skill', skillId: 'skill', toolId: 'claude-code', scope: 'system', version: '1.0.0', installedAt: '2026-01-01', sourcePin: { sourceType: 'bundle', installLayout: 'flat', bundleBaseUrl: source.baseUrl, bundleVersion: '1.0.0' }, method: 'symlink', linkName: 'example__skill' },
      { installKey: 'repo-skill', skillId: 'repo-skill', toolId: 'claude-code', scope: 'repo', repoRoot: '/example/repo', version: '1.0.0', installedAt: '2026-01-01', sourcePin: { sourceType: 'bundle', installLayout: 'flat', bundleBaseUrl: source.baseUrl, bundleVersion: '1.0.0' }, method: 'symlink', linkName: 'repo-skill' },
    ]);
    vi.mocked(updateSkillVersion).mockResolvedValueOnce({ success: false, error: 'Unsupported legacy identity' });
    vi.mocked(updateSkillVersion).mockResolvedValueOnce({ success: true });
    const instances = await listSkillVersionInstances('/example/repo');
    expect(listInstalled).toHaveBeenLastCalledWith('all', { repoRoot: '/example/repo' });
    expect(instances[0].skillName).toBe('example.com/source/skill');
    expect(instances[1].repoRoot).toBe('/example/repo');
    const result = await switchBundleVersion({ version: '2.0.0', syncInstalled: true, repoRoot: '/example/repo' });
    expect(listInstalled).toHaveBeenLastCalledWith('all', { repoRoot: '/example/repo' });
    expect(setCurrentBundle).toHaveBeenCalledExactlyOnceWith('2.0.0');
    expect(result.failures).toEqual(['claude-code/example.com/source/skill: Unsupported legacy identity']);
    expect(updateSkillVersion).toHaveBeenLastCalledWith('claude-code', 'repo-skill', '2.0.0', { scope: 'repo', repoRoot: '/example/repo' });
  });

  it('switches without enumerating or updating installs when sync is declined', async () => {
    expect(await switchBundleVersion({ version: '2.0.0', syncInstalled: false })).toEqual({ failures: [] });
    expect(setCurrentBundle).toHaveBeenCalledExactlyOnceWith('2.0.0');
    expect(listInstalled).not.toHaveBeenCalled();
    expect(updateSkillVersion).not.toHaveBeenCalled();
  });

  it('normalizes cancellation during an unauthenticated download', async () => {
    const controller = new AbortController();
    vi.mocked(downloadBundle).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Download interrupted');
    });
    await expect(downloadBundleVersion(source, '2.0.0', undefined, { signal: controller.signal }))
      .rejects.toBeInstanceOf(OperationCancelledError);
    expect(getValidBearerToken).not.toHaveBeenCalled();
    expect(setCurrentBundle).not.toHaveBeenCalled();
  });
});

it('does not sync named bundles or unrelated local sources when selecting a global bundle', async () => {
  vi.mocked(listInstalled).mockResolvedValue([
    { installKey: 'named/skill', skillId: 'skill', toolId: 'claude-code', scope: 'system', version: '1.0.0', installedAt: '', method: 'symlink', linkName: 'named-skill', sourcePin: { sourceType: 'bundle', installLayout: 'namespaced', bundleSourceName: 'named', bundleBaseUrl: source.baseUrl, bundleVersion: '1.0.0' } },
    { installKey: 'local-skill', skillId: 'local-skill', toolId: 'cursor', scope: 'system', version: '1.0.0', installedAt: '', method: 'symlink', linkName: 'local-skill', sourcePin: { sourceType: 'bundle', installLayout: 'flat', bundleDirectory: '/example/local', bundleVersion: '1.0.0' } },
  ]);
  const { resolvePinnedBundle } = await import('../../../src/bundle/version-identity.js');
  vi.mocked(resolvePinnedBundle).mockRejectedValueOnce(new Error('Different origin'));
  const result = await switchBundleVersion({ version: '2.0.0', syncInstalled: true });
  expect(updateSkillVersion).not.toHaveBeenCalled();
  expect(result.failures).toEqual([expect.stringContaining('cursor/local-skill: skipped')]);
  expect(result.failures.join()).not.toContain('download');
});
