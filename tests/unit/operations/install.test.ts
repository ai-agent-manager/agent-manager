import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillInfo } from '../../../src/bundle/scanner.js';

const repoSkills: SkillInfo[] = [
  {
    dirName: 'skill-a',
    dirPath: '/tmp/repo/skills/skill-a',
    skillMdPath: '/tmp/repo/skills/skill-a/SKILL.md',
    meta: null,
  },
  {
    dirName: 'skill-b',
    dirPath: '/tmp/repo/skills/skill-b',
    skillMdPath: '/tmp/repo/skills/skill-b/SKILL.md',
    meta: null,
  },
];

const artefactSkills: SkillInfo[] = [
  {
    dirName: 'my-artefact-skill',
    dirPath: '/tmp/artefact/my-artefact-skill',
    skillMdPath: '/tmp/artefact/my-artefact-skill/SKILL.md',
    meta: null,
  },
];

const bundleSkills: SkillInfo[] = [
  {
    dirName: 'bundle-skill',
    dirPath: '/tmp/bundle/skills/bundle-skill',
    skillMdPath: '/tmp/bundle/skills/bundle-skill/SKILL.md',
    meta: null,
  },
  {
    dirName: 'other-bundle-skill',
    dirPath: '/tmp/bundle/skills/other-bundle-skill',
    skillMdPath: '/tmp/bundle/skills/other-bundle-skill/SKILL.md',
    meta: null,
  },
];

const mockProvisioner = {
  install: vi.fn(async () => ({ installed: [], errors: [] })),
  uninstall: vi.fn(async () => ({ removed: [], errors: [] })),
  getInstalled: vi.fn(async () => []),
};

vi.mock('../../../src/provisioners/registry.js', () => ({
  createSkillProvisioner: vi.fn(() => mockProvisioner),
}));

vi.mock('../../../src/bundle/repo-downloader.js', () => ({
  downloadRepoArchive: vi.fn(async () => ({ extractDir: '/tmp/repo', isNew: true })),
}));

vi.mock('../../../src/bundle/repo-scanner.js', () => ({
  scanRepoForSkills: vi.fn(async () => ({ skills: repoSkills, skillsDir: '/tmp/repo/skills' })),
}));

vi.mock('../../../src/bundle/artefact-downloader.js', () => ({
  downloadArtefact: vi.fn(async () => ({
    extractDir: '/tmp/artefact',
    name: 'my-artefact-skill',
    version: '1.2.0',
    sha256: 'a'.repeat(64),
    isNew: true,
  })),
}));

vi.mock('../../../src/bundle/artefact-scanner.js', () => ({
  scanArtefactForSkills: vi.fn(async () => ({ skills: artefactSkills })),
}));

vi.mock('../../../src/bundle/downloader.js', () => ({
  downloadBundle: vi.fn(async () => ({ zipPath: '/tmp/bundle.zip', version: '2.0.0' })),
  downloadBundleFromIndex: vi.fn(async () => ({ zipPath: '/tmp/explicit-bundle.zip', version: '2.0.0' })),
  canonicaliseIndexUrl: vi.fn((url: string) => new URL(url).toString()),
  buildIndexUrl: vi.fn((url: string) => `${url.replace(/\/+$/, '')}/agents/index.json`),
  indexUrlSourceKey: vi.fn(() => 'explicit-source-key'),
}));

vi.mock('../../../src/bundle/extractor.js', () => ({
  extractBundle: vi.fn(async () => ({
    bundleDir: '/tmp/bundle',
    manifest: { version: '2.0.0' },
    isNew: true,
  })),
}));

vi.mock('../../../src/bundle/importer.js', () => ({
  importLocalBundle: vi.fn(async () => ({
    bundleDir: '/tmp/local-bundle',
    manifest: { version: 'dev' },
    isNew: false,
  })),
}));

vi.mock('../../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(async () => ({ skills: bundleSkills, rovoAgents: [] })),
}));

vi.mock('../../../src/bundle/cache.js', () => ({
  setCurrentBundle: vi.fn(async () => {}),
}));

vi.mock('../../../src/lib/repo.js', () => ({
  findRepoRoot: vi.fn(async () => '/tmp/my-repo'),
}));

const { installFromRepo, installFromArtefact, installFromBundle, installResolvedSkills, acquireSource } =
  await import('../../../src/operations/install.js');
const { createSkillProvisioner } = await import('../../../src/provisioners/registry.js');
const { downloadRepoArchive } = await import('../../../src/bundle/repo-downloader.js');
const { downloadArtefact } = await import('../../../src/bundle/artefact-downloader.js');
const { downloadBundle } = await import('../../../src/bundle/downloader.js');
const { findRepoRoot } = await import('../../../src/lib/repo.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockProvisioner.install.mockResolvedValue({ installed: [], errors: [] });
});

describe('installFromRepo', () => {
  it('downloads, scans, and installs all skills with a repo pin', async () => {
    const result = await installFromRepo({
      repoUrl: 'https://github.com/example-org/example-repo',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(mockProvisioner.install).toHaveBeenCalledWith(
      repoSkills,
      '',
      expect.objectContaining({
        sourceType: 'repo',
        installLayout: 'namespaced',
        repoUrl: 'https://github.com/example-org/example-repo',
      }),
    );
    expect(result.sourcePin.sourceType).toBe('repo');
    expect(createSkillProvisioner).toHaveBeenCalledWith('claude-code', 'system', undefined);
  });

  it('filters to the requested skill names', async () => {
    await installFromRepo({
      repoUrl: 'https://github.com/example-org/example-repo',
      skillNames: ['skill-b'],
      scope: 'system',
      toolId: 'claude-code',
    });

    const [installed] = mockProvisioner.install.mock.calls[0]! as unknown as [SkillInfo[]];
    expect(installed.map((s) => s.dirName)).toEqual(['skill-b']);
  });

  it('throws when a requested skill is not in the repo', async () => {
    await expect(
      installFromRepo({
        repoUrl: 'https://github.com/example-org/example-repo',
        skillNames: ['nope'],
        scope: 'system',
        toolId: 'claude-code',
      }),
    ).rejects.toThrow(/Skill\(s\) not found: nope/);
  });

  it('resolves the ref into the source pin', async () => {
    const result = await installFromRepo({
      repoUrl: 'https://github.com/example-org/example-repo',
      ref: 'v2.0',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(result.sourcePin.ref).toBe('v2.0');
  });

  it('rejects a non-repo URL', async () => {
    await expect(
      installFromRepo({
        repoUrl: 'https://cdn.example.com/thing.zip',
        scope: 'system',
        toolId: 'claude-code',
      }),
    ).rejects.toThrow(/Not a repo URL/);
  });

  it('passes GITHUB_TOKEN to the repo downloader', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'test-token');
    try {
      await installFromRepo({
        repoUrl: 'https://github.com/example-org/example-repo',
        scope: 'system',
        toolId: 'claude-code',
      });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(downloadRepoArchive).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'repo' }),
      expect.objectContaining({ token: 'test-token' }),
    );
  });

  it('uses the provided repoRoot for repo scope without re-deriving it', async () => {
    await installFromRepo({
      repoUrl: 'https://github.com/example-org/example-repo',
      scope: 'repo',
      toolId: 'claude-code',
      repoRoot: '/explicit/root',
    });

    expect(findRepoRoot).not.toHaveBeenCalled();
    expect(createSkillProvisioner).toHaveBeenCalledWith('claude-code', 'repo', '/explicit/root');
  });

  it('derives the repo root for repo scope when not provided', async () => {
    await installFromRepo({
      repoUrl: 'https://github.com/example-org/example-repo',
      scope: 'repo',
      toolId: 'claude-code',
    });

    expect(createSkillProvisioner).toHaveBeenCalledWith('claude-code', 'repo', '/tmp/my-repo');
  });

  it('fails repo scope outside a git repository', async () => {
    vi.mocked(findRepoRoot).mockResolvedValueOnce(null);

    await expect(
      installFromRepo({
        repoUrl: 'https://github.com/example-org/example-repo',
        scope: 'repo',
        toolId: 'claude-code',
      }),
    ).rejects.toThrow(/inside a git repository/);
  });
});

describe('installFromArtefact', () => {
  it('downloads, scans, and installs with a re-pinned sha256 and version', async () => {
    const result = await installFromArtefact({
      artefactUrl: 'https://cdn.example.com/my-artefact-skill-1.2.0.zip',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(mockProvisioner.install).toHaveBeenCalledWith(
      artefactSkills,
      '',
      expect.objectContaining({
        sourceType: 'artefact',
        installLayout: 'namespaced',
        sha256: 'a'.repeat(64),
        artefactVersion: '1.2.0',
      }),
    );
    expect(result.sourcePin.artefactUrl).toBe('https://cdn.example.com/my-artefact-skill-1.2.0.zip');
  });

  it('rejects a non-artefact URL', async () => {
    await expect(
      installFromArtefact({
        artefactUrl: 'https://github.com/example-org/example-repo',
        scope: 'system',
        toolId: 'claude-code',
      }),
    ).rejects.toThrow(/Not a artefact URL/);
  });

  it('forwards the bearer token to the artefact downloader', async () => {
    await installFromArtefact({
      artefactUrl: 'https://cdn.example.com/my-artefact-skill-1.2.0.zip',
      bearerToken: 'discovery-token',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(downloadArtefact).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'artefact' }),
      expect.objectContaining({ bearerToken: 'discovery-token' }),
    );
  });
});

describe('installFromBundle', () => {
  it('downloads and installs a remote bundle with a bundle pin', async () => {
    const result = await installFromBundle({
      bundleUrl: 'https://bundles.example.com',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(mockProvisioner.install).toHaveBeenCalledWith(
      bundleSkills,
      '2.0.0',
      expect.objectContaining({ sourceType: 'bundle', installLayout: 'flat' }),
    );
    expect(result.bundleVersion).toBe('2.0.0');
  });

  it('filters bundle skills to the requested names', async () => {
    await installFromBundle({
      bundleUrl: 'https://bundles.example.com',
      skillNames: ['bundle-skill'],
      scope: 'system',
      toolId: 'claude-code',
    });

    const [installed] = mockProvisioner.install.mock.calls[0]! as unknown as [SkillInfo[]];
    expect(installed.map((s) => s.dirName)).toEqual(['bundle-skill']);
  });

  it('reinstalls from an explicit index URL without converting it to a base URL', async () => {
    const { downloadBundleFromIndex } = await import('../../../src/bundle/downloader.js');
    const { extractBundle } = await import('../../../src/bundle/extractor.js');

    const result = await installFromBundle({
      bundleIndexUrl: 'https://bundles.example.com/catalogues/team-a/index.json',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(downloadBundleFromIndex).toHaveBeenCalledWith(
      'https://bundles.example.com/catalogues/team-a/index.json',
      undefined,
      undefined,
    );
    expect(extractBundle).toHaveBeenCalledWith('/tmp/explicit-bundle.zip', {
      sourceKey: 'explicit-source-key',
    });
    expect(result.sourcePin).toMatchObject({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleIndexUrl: 'https://bundles.example.com/catalogues/team-a/index.json',
    });
    expect(result.sourcePin.bundleBaseUrl).toBeUndefined();
  });

  it('forwards the bearer token to the bundle downloader', async () => {
    await installFromBundle({
      bundleUrl: 'https://bundles.example.com',
      bearerToken: 'discovery-token',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(downloadBundle).toHaveBeenCalledWith(
      'https://bundles.example.com',
      undefined,
      'discovery-token',
    );
  });

  it('forwards the bearer token on the explicit index path', async () => {
    const { downloadBundleFromIndex } = await import('../../../src/bundle/downloader.js');

    await installFromBundle({
      bundleIndexUrl: 'https://bundles.example.com/catalogues/team-a/index.json',
      bearerToken: 'discovery-token',
      scope: 'system',
      toolId: 'claude-code',
    });

    expect(downloadBundleFromIndex).toHaveBeenCalledWith(
      'https://bundles.example.com/catalogues/team-a/index.json',
      undefined,
      'discovery-token',
    );
  });
});

describe('installResolvedSkills', () => {
  it('installs the given skills relying on their per-item pins', async () => {
    const skills = [{ ...repoSkills[0]!, sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const } }];

    await installResolvedSkills({
      skills,
      toolId: 'windsurf',
      scope: 'system',
      bundleVersion: '3.0.0',
    });

    expect(mockProvisioner.install).toHaveBeenCalledWith(skills, '3.0.0');
    expect(createSkillProvisioner).toHaveBeenCalledWith('windsurf', 'system', undefined);
  });

  it('defaults bundleVersion to an empty string', async () => {
    await installResolvedSkills({
      skills: repoSkills,
      toolId: 'claude-code',
      scope: 'system',
    });

    expect(mockProvisioner.install).toHaveBeenCalledWith(repoSkills, '');
  });
});

describe('acquireSource', () => {
  it('acquires a repo source without installing', async () => {
    const result = await acquireSource({
      type: 'repo',
      repoUrl: 'https://github.com/example-org/example-repo',
      ref: 'main',
      installLayout: 'namespaced',
    });

    expect(result.skills).toEqual(repoSkills);
    expect(result.sourcePin.sourceType).toBe('repo');
    expect(mockProvisioner.install).not.toHaveBeenCalled();
  });

  it('acquires an artefact source and re-pins the downloaded hash', async () => {
    const result = await acquireSource({
      type: 'artefact',
      artefactUrl: 'https://cdn.example.com/my-artefact-skill-1.2.0.zip',
      installLayout: 'namespaced',
    });

    expect(result.skills).toEqual(artefactSkills);
    expect(result.sourcePin.sha256).toBe('a'.repeat(64));
    expect(result.sourcePin.artefactVersion).toBe('1.2.0');
  });

  it('acquires a remote bundle source with its version', async () => {
    const result = await acquireSource({
      type: 'bundle',
      baseUrl: 'https://bundles.example.com',
      installLayout: 'flat',
    });

    expect(result.skills).toEqual(bundleSkills);
    expect(result.bundleVersion).toBe('2.0.0');
    expect(result.sourcePin.sourceType).toBe('bundle');
  });

  it('acquires a local directory bundle source', async () => {
    const result = await acquireSource({
      type: 'bundle',
      dirPath: '/tmp/local-bundle',
      installLayout: 'flat',
    });

    expect(result.skills).toEqual(bundleSkills);
    expect(result.bundleVersion).toBe('dev');
  });
});
