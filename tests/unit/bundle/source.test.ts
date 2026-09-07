import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

const mockDiscovery: DiscoveryDocument = {
  version: '1',
  sources: [{ name: 'test', type: 'http', url: 'https://example.com/bundle' }],
};

const mockGitDiscovery: DiscoveryDocument = {
  version: '1',
  sources: [
    {
      name: 'agent-skills',
      type: 'git',
      url: 'https://github.com/example-org/agent-skills.git',
      status: 'official',
    },
  ],
};

vi.mock('../../../src/discovery/index.js', () => ({
  fetchDiscoveryDocument: vi.fn(async () => mockDiscovery),
}));

vi.mock('../../../src/discovery/git-probe.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/discovery/git-probe.js')>(
    '../../../src/discovery/git-probe.js',
  );
  return {
    ...actual,
    probeGitDiscovery: vi.fn(async () => null),
  };
});

const configState = { value: { installations: {} } as import('../../../src/bundle/cache.js').AgentmanConfig };

vi.mock('../../../src/bundle/cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/bundle/cache.js')>('../../../src/bundle/cache.js');
  return { ...actual, readConfig: vi.fn(async () => configState.value) };
});

const { fetchDiscoveryDocument } = await import('../../../src/discovery/index.js');
const { probeGitDiscovery } = await import('../../../src/discovery/git-probe.js');
const { resolveSource, resolvePersistedSource } = await import('../../../src/bundle/source.js');

describe('resolveSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `source-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    vi.mocked(probeGitDiscovery).mockReset();
    vi.mocked(probeGitDiscovery).mockResolvedValue(null);
    vi.mocked(fetchDiscoveryDocument).mockClear();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('returns discovery when a git remote contains a discovery document', async () => {
    vi.mocked(probeGitDiscovery).mockResolvedValueOnce(mockGitDiscovery);

    const result = await resolveSource('https://github.com/govuk-one-login/agent-skills');

    expect(result).toEqual({
      type: 'discovery',
      baseUrl: 'https://github.com/govuk-one-login/agent-skills',
      discovery: mockGitDiscovery,
    });
    expect(probeGitDiscovery).toHaveBeenCalledOnce();
    expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
  });

  it('falls back to a repo source when a GitHub remote has no discovery document', async () => {
    const result = await resolveSource('https://github.com/example-org/example-repo');

    expect(result).toEqual({
      type: 'repo',
      repoUrl: 'https://github.com/example-org/example-repo',
      defaultBranch: 'main',
      ref: 'main',
      installLayout: 'namespaced',
    });
    expect(probeGitDiscovery).toHaveBeenCalledOnce();
    expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
  });

  it('expands owner/repo shorthand through the same probe path', async () => {
    vi.mocked(probeGitDiscovery).mockResolvedValueOnce(mockGitDiscovery);

    const result = await resolveSource('govuk-one-login/agent-skills');

    expect(result).toEqual({
      type: 'discovery',
      baseUrl: 'https://github.com/govuk-one-login/agent-skills',
      discovery: mockGitDiscovery,
    });
    expect(probeGitDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'https://github.com/govuk-one-login/agent-skills',
        cloneUrl: 'https://github.com/govuk-one-login/agent-skills.git',
      }),
    );
    expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
  });

  it('prefers an existing local directory over owner/repo GitHub shorthand', async () => {
    // Resolve relative to cwd by chdir into tempDir for this assertion.
    const previous = process.cwd();
    process.chdir(tempDir);
    try {
      await mkdir(path.join('team', 'skills'), { recursive: true });
      const result = await resolveSource('team/skills');
      expect(result).toEqual({
        type: 'directory',
        dirPath: path.resolve('team/skills'),
      });
      expect(probeGitDiscovery).not.toHaveBeenCalled();
      expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
    } finally {
      process.chdir(previous);
    }
  });

  it('probes a pinned git ref and keeps it on the repo fallback', async () => {
    const result = await resolveSource('https://github.com/example-org/example-repo/tree/v2.0');

    expect(probeGitDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: 'https://github.com/example-org/example-repo',
        ref: 'v2.0',
        refPinned: true,
      }),
    );
    expect(result).toEqual({
      type: 'repo',
      repoUrl: 'https://github.com/example-org/example-repo',
      defaultBranch: 'main',
      ref: 'v2.0',
      installLayout: 'namespaced',
    });
  });

  it('rejects a non-GitHub git remote that has no discovery document', async () => {
    await expect(
      resolveSource('https://gitlab.example.com/org/catalogue.git'),
    ).rejects.toThrow(/Direct skill install.*only supported for GitHub/);
    expect(probeGitDiscovery).toHaveBeenCalledOnce();
  });

  it('returns discovery source for https URL', async () => {
    const result = await resolveSource('https://example.com');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('https://example.com');
      expect(result.discovery).toEqual(mockDiscovery);
    }
  });

  it('returns discovery source for http URL', async () => {
    const result = await resolveSource('http://localhost:3000');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('http://localhost:3000');
    }
  });

  it('returns discovery source for https URL with trailing path', async () => {
    const result = await resolveSource('https://cdn.example.com/my-org/');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('https://cdn.example.com/my-org/');
    }
  });

  it('returns directory source for an existing directory', async () => {
    const result = await resolveSource(tempDir);
    expect(result).toEqual({ type: 'directory', dirPath: tempDir });
  });

  it('resolves relative paths to absolute', async () => {
    const subDir = path.join(tempDir, 'sub');
    await mkdir(subDir, { recursive: true });
    const result = await resolveSource(subDir);
    expect(path.isAbsolute(result.type === 'directory' ? result.dirPath : '')).toBe(true);
    expect(result).toEqual({ type: 'directory', dirPath: subDir });
  });

  it('accepts directory without manifest.json', async () => {
    const result = await resolveSource(tempDir);
    expect(result).toEqual({ type: 'directory', dirPath: tempDir });
  });

  it('throws for a non-existent path', async () => {
    const badPath = path.join(tempDir, 'does-not-exist');
    await expect(resolveSource(badPath)).rejects.toThrow('Path does not exist');
  });

  it('throws for a path that is a file, not a directory', async () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');
    await expect(resolveSource(filePath)).rejects.toThrow('Path is not a directory');
  });

  it('throws for an invalid URL', async () => {
    await expect(resolveSource('https://')).rejects.toThrow();
  });
});

describe('resolvePersistedSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `persisted-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configState.value = { installations: {} };
    vi.mocked(probeGitDiscovery).mockReset();
    vi.mocked(probeGitDiscovery).mockResolvedValue(null);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when no sources are configured', async () => {
    expect(await resolvePersistedSource()).toBeNull();
  });

  it('resolves the active source first', async () => {
    configState.value = {
      installations: {},
      sources: [{ kind: 'directory', value: tempDir }],
      activeSource: { kind: 'directory', value: tempDir },
    };

    const resolved = await resolvePersistedSource();
    expect(resolved?.source).toEqual({ type: 'directory', dirPath: tempDir });
    expect(resolved?.stored).toEqual({ kind: 'directory', value: tempDir });
  });

  it('re-probes a persisted GitHub URL and returns repo when discovery is absent', async () => {
    const stored = {
      kind: 'discovery' as const,
      value: 'https://github.com/example-org/example-repo',
    };
    configState.value = {
      installations: {},
      sources: [stored],
      activeSource: stored,
    };

    const resolved = await resolvePersistedSource();

    expect(resolved?.source.type).toBe('repo');
    expect(resolved?.stored).toEqual(stored);
    expect(probeGitDiscovery).toHaveBeenCalledOnce();
    expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
  });

  it('re-probes a persisted GitHub URL and returns discovery when the document appears', async () => {
    vi.mocked(probeGitDiscovery).mockResolvedValueOnce(mockGitDiscovery);
    const stored = {
      kind: 'repo' as const,
      value: 'https://github.com/govuk-one-login/agent-skills',
    };
    configState.value = {
      installations: {},
      sources: [stored],
      activeSource: stored,
    };

    const resolved = await resolvePersistedSource();

    expect(resolved?.source).toEqual({
      type: 'discovery',
      baseUrl: 'https://github.com/govuk-one-login/agent-skills',
      discovery: mockGitDiscovery,
    });
  });

  it('skips a source that fails to resolve and tries the next (per-source isolation)', async () => {
    const badPath = path.join(tempDir, 'does-not-exist');
    configState.value = {
      installations: {},
      sources: [
        { kind: 'directory', value: badPath },
        { kind: 'directory', value: tempDir },
      ],
    };

    const resolved = await resolvePersistedSource();
    expect(resolved?.stored).toEqual({ kind: 'directory', value: tempDir });
  });

  it('throws an aggregated error when every source fails', async () => {
    configState.value = {
      installations: {},
      sources: [
        { kind: 'directory', value: path.join(tempDir, 'nope-1') },
        { kind: 'directory', value: path.join(tempDir, 'nope-2') },
      ],
    };

    await expect(resolvePersistedSource()).rejects.toThrow('None of the configured sources');
  });
});
