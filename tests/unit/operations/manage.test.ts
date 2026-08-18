import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkillSourcePin } from '../../../src/bundle/skill-source.js';

const repoPin: SkillSourcePin = {
  sourceType: 'repo',
  installLayout: 'namespaced',
  repoUrl: 'https://github.com/example-org/example-repo',
  ref: 'main',
};

const artefactPin: SkillSourcePin = {
  sourceType: 'artefact',
  installLayout: 'namespaced',
  artefactUrl: 'https://cdn.example.com/my-skill-1.2.0.zip',
  sha256: 'a'.repeat(64),
  artefactVersion: '1.2.0',
};

const bundlePin: SkillSourcePin = {
  sourceType: 'bundle',
  installLayout: 'flat',
  bundleBaseUrl: 'https://bundles.example.com',
  bundleVersion: '1.0.0',
};

const systemConfig = {
  installations: {
    'claude-code': {
      'github.com/example-org/example-repo/my-skill': {
        installedAt: '2026-01-01T00:00:00.000Z',
        method: 'symlink' as const,
        sourcePin: repoPin,
        linkName: 'github.com~example-org~example-repo__my-skill',
      },
      'cdn.example.com/my-skill/my-skill': {
        installedAt: '2026-01-02T00:00:00.000Z',
        method: 'symlink' as const,
        sourcePin: artefactPin,
        linkName: 'cdn.example.com~my-skill__my-skill',
      },
      'legacy-skill': {
        installedAt: '2025-01-01T00:00:00.000Z',
        method: 'symlink' as const,
        bundleVersion: '0.9.0',
      },
    },
  },
};

const repoConfig = {
  installations: {
    'claude-code': {
      'bundle-skill': {
        installedAt: '2026-01-03T00:00:00.000Z',
        method: 'copy' as const,
        sourcePin: bundlePin,
      },
    },
  },
};

const mockProvisioner = {
  install: vi.fn(async () => ({ installed: [], errors: [] })),
  uninstall: vi.fn(async () => ({ removed: [], errors: [] })),
  getInstalled: vi.fn(async () => []),
};

vi.mock('../../../src/provisioners/registry.js', () => ({
  createSkillProvisioner: vi.fn(() => mockProvisioner),
}));

vi.mock('../../../src/bundle/cache.js', () => ({
  readConfig: vi.fn(async () => systemConfig),
  getRecordVersion: vi.fn(
    (rec: { sourcePin?: SkillSourcePin; bundleVersion?: string }) =>
      rec.sourcePin?.bundleVersion ?? rec.bundleVersion ?? '',
  ),
}));

vi.mock('../../../src/bundle/repo-config.js', () => ({
  readRepoConfig: vi.fn(async () => repoConfig),
}));

vi.mock('../../../src/lib/repo.js', () => ({
  findRepoRoot: vi.fn(async () => '/tmp/my-repo'),
}));

vi.mock('../../../src/operations/install.js', () => ({
  installFromRepo: vi.fn(async () => ({ result: { installed: [], errors: [] } })),
  installFromArtefact: vi.fn(async () => ({ result: { installed: [], errors: [] } })),
  installFromBundle: vi.fn(async () => ({ result: { installed: [], errors: [] } })),
}));

const {
  listInstalled,
  resolveIdentifier,
  updateInstalled,
  removeInstalled,
  AmbiguousIdentifierError,
  SkillNotFoundError,
} = await import('../../../src/operations/manage.js');
const { createSkillProvisioner } = await import('../../../src/provisioners/registry.js');
const { installFromRepo, installFromArtefact, installFromBundle } = await import(
  '../../../src/operations/install.js'
);
const { findRepoRoot } = await import('../../../src/lib/repo.js');
const { readConfig } = await import('../../../src/bundle/cache.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findRepoRoot).mockResolvedValue('/tmp/my-repo');
});

describe('listInstalled', () => {
  it('lists system and repo installs with derived fields', async () => {
    const records = await listInstalled('all');

    expect(records).toHaveLength(4);

    const namespaced = records.find((r) => r.installKey === 'github.com/example-org/example-repo/my-skill')!;
    expect(namespaced.skillId).toBe('my-skill');
    expect(namespaced.scope).toBe('system');
    expect(namespaced.linkName).toBe('github.com~example-org~example-repo__my-skill');
    expect(namespaced.version).toBe('main');

    const artefact = records.find((r) => r.installKey === 'cdn.example.com/my-skill/my-skill')!;
    expect(artefact.version).toBe('1.2.0');

    const repoScoped = records.find((r) => r.installKey === 'bundle-skill')!;
    expect(repoScoped.scope).toBe('repo');
    expect(repoScoped.repoRoot).toBe('/tmp/my-repo');
    expect(repoScoped.version).toBe('1.0.0');
  });

  it('falls back to the bare skillId link name for legacy records', async () => {
    const records = await listInstalled('system');
    const legacy = records.find((r) => r.installKey === 'legacy-skill')!;

    expect(legacy.linkName).toBe('legacy-skill');
    expect(legacy.sourcePin).toBeUndefined();
    expect(legacy.version).toBe('0.9.0');
  });

  it('filters by scope', async () => {
    const system = await listInstalled('system');
    expect(system.every((r) => r.scope === 'system')).toBe(true);
    expect(system).toHaveLength(3);

    const repo = await listInstalled('repo');
    expect(repo).toHaveLength(1);
    expect(repo[0]!.installKey).toBe('bundle-skill');
  });

  it('skips repo scope when not inside a git repository', async () => {
    vi.mocked(findRepoRoot).mockResolvedValue(null);
    const records = await listInstalled('all');
    expect(records.every((r) => r.scope === 'system')).toBe(true);
  });
});

describe('resolveIdentifier', () => {
  it('resolves an exact install key', async () => {
    const record = await resolveIdentifier('github.com/example-org/example-repo/my-skill');
    expect(record.sourcePin?.sourceType).toBe('repo');
  });

  it('resolves an unambiguous bare skillId', async () => {
    const record = await resolveIdentifier('legacy-skill');
    expect(record.installKey).toBe('legacy-skill');
  });

  it('throws AmbiguousIdentifierError for a bare id with multiple matches', async () => {
    await expect(resolveIdentifier('my-skill')).rejects.toThrow(AmbiguousIdentifierError);
    await expect(resolveIdentifier('my-skill')).rejects.toThrow(
      /github\.com\/example-org\/example-repo\/my-skill/,
    );
  });

  it('throws SkillNotFoundError when nothing matches', async () => {
    await expect(resolveIdentifier('nonexistent')).rejects.toThrow(SkillNotFoundError);
  });

  describe('same skill installed for several tools', () => {
    // One record per tool, all sharing an installKey — so an exact-key lookup
    // is ambiguous unless the caller says which tool it means.
    const multiToolConfig = {
      installations: {
        'claude-code': {
          'github.com/example-org/example-repo/my-skill': {
            installedAt: '2026-01-01T00:00:00.000Z',
            method: 'symlink' as const,
            sourcePin: repoPin,
          },
        },
        cursor: {
          'github.com/example-org/example-repo/my-skill': {
            installedAt: '2026-01-01T00:00:00.000Z',
            method: 'symlink' as const,
            sourcePin: repoPin,
          },
        },
      },
    };

    beforeEach(() => {
      vi.mocked(readConfig).mockResolvedValue(multiToolConfig);
    });

    // mockResolvedValue outlives clearAllMocks, so restore the shared fixture.
    afterEach(() => {
      vi.mocked(readConfig).mockResolvedValue(systemConfig);
    });

    it('is ambiguous on an exact install key without a toolId', async () => {
      await expect(
        resolveIdentifier('github.com/example-org/example-repo/my-skill', 'system'),
      ).rejects.toThrow(AmbiguousIdentifierError);
    });

    it('resolves to the requested tool when a toolId is given', async () => {
      const record = await resolveIdentifier(
        'github.com/example-org/example-repo/my-skill',
        'system',
        'cursor',
      );
      expect(record.toolId).toBe('cursor');
    });
  });

  it('narrows ambiguity with a scope hint', async () => {
    const record = await resolveIdentifier('bundle-skill', 'repo');
    expect(record.scope).toBe('repo');
  });
});

describe('updateInstalled', () => {
  it('updates a repo-pinned skill from its pin, forwarding repoRoot', async () => {
    await updateInstalled('github.com/example-org/example-repo/my-skill');

    expect(installFromRepo).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/example-org/example-repo',
      ref: 'main',
      skillNames: ['my-skill'],
      scope: 'system',
      toolId: 'claude-code',
      repoRoot: undefined,
      forceUpdate: true,
    });
  });

  it('updates an artefact-pinned skill without the pinned sha256', async () => {
    await updateInstalled('cdn.example.com/my-skill/my-skill');

    expect(installFromArtefact).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(installFromArtefact).mock.calls[0]![0];
    expect(opts.artefactUrl).toBe('https://cdn.example.com/my-skill-1.2.0.zip');
    expect(opts.forceUpdate).toBe(true);
    expect(opts.sha256).toBeUndefined();
  });

  it('uses the token provider when reinstalling an artefact', async () => {
    const getAccessToken = vi.fn(async () => 'discovery-token');

    await updateInstalled(
      'cdn.example.com/my-skill/my-skill',
      undefined,
      undefined,
      getAccessToken,
    );

    expect(getAccessToken).toHaveBeenCalledWith(
      'https://cdn.example.com/my-skill-1.2.0.zip',
    );
    expect(vi.mocked(installFromArtefact).mock.calls[0]![0].bearerToken).toBe(
      'discovery-token',
    );
  });

  it('updates a bundle-pinned skill to the latest version, filtered to that skill', async () => {
    await updateInstalled('bundle-skill');

    expect(installFromBundle).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(installFromBundle).mock.calls[0]![0];
    expect(opts.bundleUrl).toBe('https://bundles.example.com');
    expect(opts.skillNames).toEqual(['bundle-skill']);
    expect(opts.repoRoot).toBe('/tmp/my-repo');
    expect(opts.bundleVersion).toBeUndefined();
  });

  it('retains the declared source name and content root when updating', async () => {
    vi.mocked(readConfig).mockResolvedValueOnce({
      installations: {
        'claude-code': {
          'team-a/explicit-skill': {
            installedAt: '2026-01-04T00:00:00.000Z',
            method: 'symlink' as const,
            sourcePin: {
              sourceType: 'bundle' as const,
              installLayout: 'namespaced' as const,
              bundleBaseUrl: 'https://content.example.com/catalogues/team-a',
              bundleSourceName: 'team-a',
              bundleVersion: '1.0.0',
            },
          },
        },
      },
    });

    await updateInstalled(
      'team-a/explicit-skill',
      'system',
      'claude-code',
    );

    expect(installFromBundle).toHaveBeenCalledWith({
      bundleUrl: 'https://content.example.com/catalogues/team-a',
      sourceName: 'team-a',
      bearerToken: undefined,
      skillNames: ['explicit-skill'],
      scope: 'system',
      toolId: 'claude-code',
      repoRoot: undefined,
      forceUpdate: true,
    });
  });

  it('asks the token provider for the content root of a declared source', async () => {
    vi.mocked(readConfig).mockResolvedValueOnce({
      installations: {
        'claude-code': {
          'team-a/explicit-skill': {
            installedAt: '2026-01-04T00:00:00.000Z',
            method: 'symlink' as const,
            sourcePin: {
              sourceType: 'bundle' as const,
              installLayout: 'namespaced' as const,
              bundleBaseUrl: 'https://content.example.com/catalogues/team-a',
              bundleSourceName: 'team-a',
              bundleVersion: '1.0.0',
            },
          },
        },
      },
    });
    const getAccessToken = vi.fn(async () => 'discovery-token');

    await updateInstalled(
      'team-a/explicit-skill',
      'system',
      'claude-code',
      getAccessToken,
    );

    expect(getAccessToken).toHaveBeenCalledWith('https://content.example.com/catalogues/team-a');
    expect(vi.mocked(installFromBundle).mock.calls[0]![0].bearerToken).toBe('discovery-token');
  });

  it('uses the same token provider for HTTP bundle updates', async () => {
    const getAccessToken = vi.fn(async () => 'discovery-token');

    await updateInstalled('bundle-skill', undefined, undefined, getAccessToken);

    expect(getAccessToken).toHaveBeenCalledWith('https://bundles.example.com');
    expect(vi.mocked(installFromBundle).mock.calls[0]![0].bearerToken).toBe(
      'discovery-token',
    );
  });

  it('keeps unauthenticated updates unchanged when no provider is supplied', async () => {
    await updateInstalled('bundle-skill');

    expect(vi.mocked(installFromBundle).mock.calls[0]![0].bearerToken).toBeUndefined();
  });

  it('does not use the discovery token provider for repository updates', async () => {
    const getAccessToken = vi.fn(async () => 'discovery-token');

    await updateInstalled(
      'github.com/example-org/example-repo/my-skill',
      undefined,
      undefined,
      getAccessToken,
    );

    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('rejects updating a record without a source pin', async () => {
    await expect(updateInstalled('legacy-skill')).rejects.toThrow(/no source pin recorded/);
  });
});

describe('removeInstalled', () => {
  it('uninstalls by full install key with the record scope and repoRoot', async () => {
    await removeInstalled('bundle-skill');

    expect(createSkillProvisioner).toHaveBeenCalledWith('claude-code', 'repo', '/tmp/my-repo');
    expect(mockProvisioner.uninstall).toHaveBeenCalledWith(['bundle-skill']);
  });

  it('propagates ambiguity instead of guessing', async () => {
    await expect(removeInstalled('my-skill')).rejects.toThrow(AmbiguousIdentifierError);
    expect(mockProvisioner.uninstall).not.toHaveBeenCalled();
  });
});
