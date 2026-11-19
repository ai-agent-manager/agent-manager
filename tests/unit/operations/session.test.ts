import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSession, loadSessionMembership, resolveStartupSource, runStartupChecks } from '../../../src/operations/session.js';
import { buildSessionCatalogue } from '../../../src/operations/catalogue.js';
import { resolveSource, resolvePersistedSource } from '../../../src/bundle/source.js';
import { addSource, setCurrentBundle, readConfig, getCurrentBundleVersion } from '../../../src/bundle/cache.js';
import { getBundleVersionDir } from '../../../src/config/paths.js';
import { scanBundle } from '../../../src/bundle/scanner.js';
import { trackTelemetryError } from '../../../src/telemetry.js';
import { OperationCancelledError } from '../../../src/operations/cancellation.js';
import { importLocalBundle } from '../../../src/bundle/importer.js';
import { resolveDiscoverySkills } from '../../../src/discovery/index.js';
import { authenticate, AuthCancelledError } from '../../../src/auth/index.js';
import { listProjects, ApiError } from '../../../src/api/index.js';
import type { BundleSource } from '../../../src/bundle/source.js';

vi.mock('../../../src/bundle/cache.js', async (original) => ({
  ...await original<typeof import('../../../src/bundle/cache.js')>(),
  readConfig: vi.fn(async () => ({ installations: {} })),
  updateConfig: vi.fn(async () => {}),
  getCurrentBundleVersion: vi.fn(async () => null),
  setCurrentBundle: vi.fn(async () => {}),
  addSource: vi.fn(async () => {}),
}));
vi.mock('../../../src/bundle/source.js', async (original) => ({
  ...await original<typeof import('../../../src/bundle/source.js')>(),
  resolveSource: vi.fn(), resolvePersistedSource: vi.fn(),
}));
vi.mock('../../../src/bundle/importer.js', () => ({ importLocalBundle: vi.fn() }));
vi.mock('../../../src/config/paths.js', async (original) => ({
  ...await original<typeof import('../../../src/config/paths.js')>(), getBundleVersionDir: vi.fn(),
}));
vi.mock('../../../src/bundle/scanner.js', async (original) => {
  const actual = await original<typeof import('../../../src/bundle/scanner.js')>();
  return { ...actual, scanBundle: vi.fn(actual.scanBundle) };
});
vi.mock('../../../src/discovery/index.js', async (original) => ({
  ...await original<typeof import('../../../src/discovery/index.js')>(),
  resolveDiscoverySkills: vi.fn(),
}));
vi.mock('../../../src/auth/index.js', async (original) => ({
  ...await original<typeof import('../../../src/auth/index.js')>(),
  authenticate: vi.fn(), getValidBearerToken: vi.fn(async () => 'test-token'),
}));
vi.mock('../../../src/api/index.js', async (original) => ({
  ...await original<typeof import('../../../src/api/index.js')>(), listProjects: vi.fn(),
}));
vi.mock('../../../src/telemetry.js', async (original) => ({
  ...await original<typeof import('../../../src/telemetry.js')>(),
  trackTelemetryError: vi.fn(), trackTelemetryEvent: vi.fn(), setTelemetryDisabledByConfig: vi.fn(),
}));

const fixture = fileURLToPath(new URL('../../fixtures/valid-bundle/', import.meta.url));
const source: Extract<BundleSource, { type: 'discovery' }> = {
  type: 'discovery', baseUrl: 'https://catalogue.example.com', discovery: {
    version: '1',
    sources: [],
    auth: { required: true, oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration', clientId: 'test-client' },
    api: { baseUrl: 'https://api.example.com' },
    projects: { enabled: true, exclusiveSource: true },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listProjects).mockReset();
  vi.mocked(getBundleVersionDir).mockReturnValue(fixture);
  vi.mocked(authenticate).mockResolvedValue({ bearerToken: 'test-token', fromCache: false, backend: 'filesystem' });
  vi.mocked(resolveDiscoverySkills).mockResolvedValue({
    skills: ['allowed', 'excluded'].map((dirName) => ({
      dirName, dirPath: path.join(fixture, dirName), skillMdPath: path.join(fixture, dirName, 'SKILL.md'),
      sourceName: 'official', sourceType: 'http',
    })), rovoAgents: [], errors: [],
  });
  vi.mocked(listProjects).mockResolvedValue([{
    id: 'project', name: 'Example project', teamId: 'team', toolIds: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', restrictSkills: true, allowedSkillIds: ['allowed'],
  }]);
});

describe('startup resolution', () => {
  it('keeps direct repository sources and supports deferred persistence', async () => {
    const repo = { type: 'repo' as const, repoUrl: 'https://github.com/example/skills', ref: 'main', installLayout: 'namespaced' as const };
    vi.mocked(resolveSource).mockResolvedValue(repo);
    const resolved = await resolveStartupSource(repo.repoUrl, { persist: false });
    expect(resolved.directInstallSource).toEqual(repo);
    expect(addSource).not.toHaveBeenCalled();
    await resolveStartupSource(repo.repoUrl);
    expect(addSource).toHaveBeenCalledWith(resolved.stored, { setActive: true });
  });

  it('opens source management with a warning when persisted resolution fails', async () => {
    vi.mocked(resolvePersistedSource).mockRejectedValueOnce(new Error('Source unavailable'));
    const session = await loadSession(await resolveStartupSource());
    expect(session.source).toBeUndefined();
    expect(session.warnings).toEqual([expect.stringContaining('Source unavailable')]);
    expect(resolveDiscoverySkills).not.toHaveBeenCalled();
  });

  it('keeps explicit source errors fatal', async () => {
    vi.mocked(resolveSource).mockRejectedValueOnce(new Error('Invalid source'));
    await expect(resolveStartupSource('invalid')).rejects.toThrow('Invalid source');
  });
});

describe('session catalogue', () => {
  it('allows TUI membership deferral without granting catalogue access before completion', async () => {
    const session = await loadSession({ source }, { onAuthPrompt: vi.fn(), deferMembership: true });
    expect(listProjects).not.toHaveBeenCalled();
    expect(session.membership.state).toBe('loading');
    expect(buildSessionCatalogue(session)).toEqual([]);
    await loadSessionMembership(session);
    expect(session.membership.state).toBe('ready');
    expect(buildSessionCatalogue(session).map((entry) => entry.skillId)).toEqual(['allowed']);
  });
  it('retains membership filtering even without a My Projects screen', async () => {
    const onAuthPrompt = vi.fn();
    const session = await loadSession({ source }, { onAuthPrompt });
    expect(session.membership.state).toBe('ready');
    expect(session.auth).toEqual({ required: true, authenticated: true, backend: 'filesystem' });
    expect(buildSessionCatalogue(session).map((entry) => entry.skillId)).toEqual(['allowed']);
    expect(session.discoverySkills).toHaveLength(2);
  });

  it.each(['empty', 'failure', 'missing-context'])('fails closed for %s membership', async (mode) => {
    const onWarning = vi.fn();
    if (mode === 'failure') vi.mocked(listProjects).mockRejectedValueOnce(new Error('API unavailable'));
    else vi.mocked(listProjects).mockResolvedValueOnce([]);
    const selected = mode === 'missing-context'
      ? { ...source, discovery: { ...source.discovery, auth: undefined } }
      : source;
    const session = await loadSession({ source: selected }, { onWarning, onAuthPrompt: vi.fn() });
    expect(buildSessionCatalogue(session)).toEqual([]);
    expect(session.membership.state).toBe(mode === 'empty' ? 'ready' : 'error');
    if (mode === 'failure') expect(onWarning).toHaveBeenCalledWith(expect.stringContaining('Could not load project memberships'));
    if (mode === 'missing-context') {
      expect(onWarning).not.toHaveBeenCalled();
      expect(session.membership.error).toContain('requires an API base URL and authentication');
    }
  });

  it('allows unrestricted sources without fetching memberships', async () => {
    const selected = { ...source, discovery: { ...source.discovery, projects: undefined } };
    const session = await loadSession({ source: selected });
    expect(buildSessionCatalogue(session)).toHaveLength(2);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('scans a real local bundle and preserves directory source pins without selecting a global version', async () => {
    vi.mocked(importLocalBundle).mockResolvedValueOnce({
      manifest: { version: '1.0.0', published: '2026-01-01', agents: [] },
      bundleDir: fixture, isNew: false,
    });
    const session = await loadSession({ source: { type: 'directory', dirPath: fixture } }, { persist: false });
    const catalogue = buildSessionCatalogue(session);
    expect(catalogue.some((entry) => entry.skillId === 'test-skill')).toBe(true);
    const skill = catalogue.find((entry) => entry.kind === 'skill');
    expect(skill?.kind === 'skill' && skill.candidates[0].skill.sourcePin?.sourceType).toBe('bundle');
    expect(setCurrentBundle).not.toHaveBeenCalled();
  });
});

describe('session cancellation', () => {
  it('does no work when already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadSession({ source }, { signal: controller.signal })).rejects.toBeInstanceOf(OperationCancelledError);
    expect(readConfig).not.toHaveBeenCalled();
  });

  it('forwards startup auth cancellation and never acquires content afterwards', async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(authenticate).mockImplementationOnce(async (_url, _auth, _prompt, options) => {
      entered();
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new AuthCancelledError()), { once: true }));
    });
    const loading = loadSession({ source }, { signal: controller.signal, onAuthPrompt: vi.fn() });
    const rejection = expect(loading).rejects.toBeInstanceOf(OperationCancelledError);
    await started;
    controller.abort();
    await rejection;
    expect(resolveDiscoverySkills).not.toHaveBeenCalled();
  });

  it('does not publish an empty success when aborted during membership loading', async () => {
    const controller = new AbortController();
    vi.mocked(listProjects).mockImplementationOnce(async () => { controller.abort(); return []; });
    await expect(loadSession({ source }, { signal: controller.signal })).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('normalizes cancellation from source resolution instead of reporting a load failure', async () => {
    const controller = new AbortController();
    vi.mocked(resolveDiscoverySkills).mockImplementationOnce(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    await expect(loadSession({ source }, { signal: controller.signal })).rejects.toBeInstanceOf(OperationCancelledError);
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('keeps discovery startup checks opt-out consistent with the TUI', async () => {
    const session = await loadSession({ source });
    expect(await runStartupChecks(session)).toEqual({ notices: [], errors: [] });
  });

  it('defensively normalizes raw startup auth errors after abort', async () => {
    const controller = new AbortController();
    vi.mocked(authenticate).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Raw callback failure');
    });
    await expect(loadSession({ source }, { signal: controller.signal, onAuthPrompt: vi.fn() }))
      .rejects.toThrow(OperationCancelledError);
    expect(resolveDiscoverySkills).not.toHaveBeenCalled();
  });

  it('uses neutral cancellation for an unauthenticated local import', async () => {
    const controller = new AbortController();
    vi.mocked(importLocalBundle).mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('Import interrupted');
    });
    await expect(loadSession({ source: { type: 'directory', dirPath: fixture } }, { signal: controller.signal }))
      .rejects.toThrow('Operation cancelled');
    expect(authenticate).not.toHaveBeenCalled();
    expect(setCurrentBundle).not.toHaveBeenCalled();
  });
});

describe('session diagnostics', () => {
  it.each([
    [new ApiError('Denied', 401), 'Authentication failed while loading project memberships. Sign in again and retry.\nDenied'],
    [new ApiError('Unavailable', 503), 'Temporarily unable to load project memberships for exclusive catalogue filtering. The catalogue is empty until this succeeds.\nUnavailable'],
    [new Error('Invalid response'), 'Could not load project memberships for exclusive catalogue filtering:\nInvalid response'],
  ])('retains classified membership diagnostics for %s', async (error, expected) => {
    vi.mocked(listProjects).mockRejectedValueOnce(error);
    const session = await loadSession({ source });
    expect(session.membership.error).toBe(expected);
    expect(session.warnings).toContain(expected);
    expect(buildSessionCatalogue(session)).toEqual([]);
  });

  it('reports cached manifest failures with source and version context', async () => {
    vi.mocked(getCurrentBundleVersion).mockResolvedValueOnce('missing');
    vi.mocked(getBundleVersionDir).mockReturnValueOnce(path.join(fixture, 'missing-version'));
    await expect(loadSession({ source: { type: 'url', baseUrl: 'https://skills.example.com' } })).rejects.toThrow();
    expect(trackTelemetryError).toHaveBeenCalledWith('bundle_manifest_load_failed', expect.any(Error),
      expect.objectContaining({ source: 'url', version: 'missing' }));
  });

  it('reports cached scan failures instead of losing the telemetry event', async () => {
    vi.mocked(getCurrentBundleVersion).mockResolvedValueOnce('1.0.0');
    vi.mocked(scanBundle).mockRejectedValueOnce(new Error('Scan failed'));
    await expect(loadSession({ source: { type: 'url', baseUrl: 'https://skills.example.com' } })).rejects.toThrow('Scan failed');
    expect(trackTelemetryError).toHaveBeenCalledWith('bundle_scan_failed', expect.any(Error),
      expect.objectContaining({ source: 'url', version: 'abc1234def5678' }));
  });

  it('emits the setup progress message for newly imported bundles', async () => {
    vi.mocked(importLocalBundle).mockResolvedValueOnce({
      manifest: { version: '1.0.0', published: '2026-01-01' }, bundleDir: fixture, isNew: true,
    });
    const onProgress = vi.fn();
    await loadSession({ source: { type: 'directory', dirPath: fixture } }, { onProgress, persist: false });
    expect(onProgress).toHaveBeenCalledWith('Setting up new bundle version...');
  });
});
