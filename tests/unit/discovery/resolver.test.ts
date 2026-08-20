import { describe, it, expect, vi } from 'vitest';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';
import type { SkillInfo } from '../../../src/bundle/scanner.js';

const mockGitSkills: SkillInfo[] = [
  {
    dirName: 'git-skill-a',
    dirPath: '/tmp/git-cache/repo/skills/git-skill-a',
    skillMdPath: '/tmp/git-cache/repo/skills/git-skill-a/SKILL.md',
    meta: null,
  },
];

const mockBundleSkills: SkillInfo[] = [
  {
    dirName: 'http-skill-a',
    dirPath: '/tmp/bundles/skills/http-skill-a',
    skillMdPath: '/tmp/bundles/skills/http-skill-a/SKILL.md',
    meta: null,
  },
];

vi.mock('../../../src/bundle/downloader.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/bundle/downloader.js')>(
    '../../../src/bundle/downloader.js',
  );
  return {
    ...actual,
    downloadBundle: vi.fn(async () => ({
      zipPath: '/tmp/bundle.zip',
      version: '1.0.0',
    })),
  };
});

vi.mock('../../../src/bundle/extractor.js', () => ({
  extractBundle: vi.fn(async () => ({
    bundleDir: '/tmp/bundles',
    manifest: { version: '1.0.0', published: '2024-01-01T00:00:00Z', agents: [] },
    isNew: true,
  })),
}));

vi.mock('../../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(async () => ({
    skills: mockBundleSkills,
    rovoAgents: [],
  })),
}));

vi.mock('../../../src/bundle/cache.js', () => ({
  setCurrentBundle: vi.fn(async () => {}),
}));

vi.mock('../../../src/discovery/git-importer.js', () => ({
  importGitSkills: vi.fn(async () => ({
    skills: mockGitSkills,
    clonePath: '/tmp/git-cache/repo',
  })),
}));

vi.mock('../../../src/bundle/artefact-downloader.js', () => ({
  downloadArtefact: vi.fn(),
}));

vi.mock('../../../src/bundle/artefact-scanner.js', () => ({
  scanArtefactForSkills: vi.fn(async () => ({ skills: [] })),
}));

const { resolveDiscoverySkills } = await import(
  '../../../src/discovery/resolver.js'
);

describe('resolveDiscoverySkills', () => {
  it('resolves git skills from a discovery document', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'my-repo', type: 'git', url: 'https://github.com/example/repo.git' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.dirName).toBe('git-skill-a');
    expect(result.skills[0]!.sourcePin?.installLayout).toBe('namespaced');
    expect(result.skills[0]!.sourcePin?.sourceType).toBe('repo');
    expect(result.errors).toHaveLength(0);
  });

  it('resolves http skills from a discovery document', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bundle', type: 'http', url: 'https://cdn.example.com/bundle' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.dirName).toBe('http-skill-a');
    expect(result.skills[0]!.sourcePin?.installLayout).toBe('namespaced');
    expect(result.skills[0]!.sourcePin?.sourceType).toBe('bundle');
    expect(result.skills[0]!.sourcePin?.bundleSourceName).toBe('bundle');
    expect(result.bundleVersion).toBe('1.0.0');
    expect(result.manifest).toEqual({
      version: '1.0.0',
      published: '2024-01-01T00:00:00Z',
      agents: [],
    });
    expect(result.bundleDir).toBe('/tmp/bundles');
    expect(result.errors).toHaveLength(0);
  });

  it('does not point the current-bundle symlink at a source-scoped extract', async () => {
    const { setCurrentBundle } = await import('../../../src/bundle/cache.js');
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [{ name: 'bundle', type: 'http', url: 'https://cdn.example.com/agents' }],
    };

    await resolveDiscoverySkills(doc);

    // `current` links into the version-keyed cache, which a source-scoped
    // extract never populates — setting it would leave a dangling link.
    expect(setCurrentBundle).not.toHaveBeenCalled();
  });

  it('reads a content root as declared and pins the source name, not the URL', async () => {
    const { downloadBundle } = await import('../../../src/bundle/downloader.js');
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        {
          name: 'team-a',
          type: 'http',
          url: 'https://cdn.example.com/catalogues/team-a',
        },
      ],
    };

    const result = await resolveDiscoverySkills(doc, 'token');

    expect(downloadBundle).toHaveBeenCalledWith(
      'https://cdn.example.com/catalogues/team-a',
      undefined,
      'token',
      'team-a',
    );
    expect(result.skills[0]!.sourcePin).toMatchObject({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleSourceName: 'team-a',
      bundleBaseUrl: 'https://cdn.example.com/catalogues/team-a',
      bundleVersion: '1.0.0',
    });
  });

  it('prefers the HTTP source that contributed Rovo agents for manifest/bundleDir', async () => {
    const { extractBundle } = await import('../../../src/bundle/extractor.js');
    const { scanBundle } = await import('../../../src/bundle/scanner.js');

    // Rovo source is listed first so first-Rovo-wins and last-wins disagree.
    vi.mocked(extractBundle)
      .mockResolvedValueOnce({
        bundleDir: '/tmp/with-rovo',
        manifest: { version: 'rovo-1', published: '2024-02-01T00:00:00Z', agents: [] },
        isNew: true,
      })
      .mockResolvedValueOnce({
        bundleDir: '/tmp/skills-only',
        manifest: { version: 'skills-1', published: '2024-01-01T00:00:00Z', agents: [] },
        isNew: true,
      });

    vi.mocked(scanBundle)
      .mockResolvedValueOnce({
        skills: [],
        rovoAgents: [
          {
            dirName: 'agent-a',
            dirPath: '/tmp/with-rovo/agent-a',
            configPath: '/tmp/with-rovo/agent-a/rovo-agent.yaml',
            config: {} as never,
            meta: null,
            knowledgeBaseFiles: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        skills: mockBundleSkills,
        rovoAgents: [],
      });

    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'rovo-bundle', type: 'http', url: 'https://cdn.example.com/rovo' },
        { name: 'skills-bundle', type: 'http', url: 'https://cdn.example.com/skills' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.rovoAgents).toHaveLength(1);
    expect(result.manifest?.version).toBe('rovo-1');
    expect(result.bundleDir).toBe('/tmp/with-rovo');
  });

  it('omits manifest and bundleDir when no HTTP sources resolve', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'my-repo', type: 'git', url: 'https://github.com/example/repo.git' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.manifest).toBeUndefined();
    expect(result.bundleDir).toBeUndefined();
  });

  it('resolves mixed http and git skills', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bundle', type: 'http', url: 'https://cdn.example.com/bundle' },
        { name: 'repo', type: 'git', url: 'https://github.com/example/repo.git' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('forwards the discovery token to artefact downloads', async () => {
    const { downloadArtefact } = await import(
      '../../../src/bundle/artefact-downloader.js'
    );
    vi.mocked(downloadArtefact).mockResolvedValueOnce({
      extractDir: '/tmp/artefact',
      name: 'protected-skill',
      version: '1.0.0',
      sha256: 'a'.repeat(64),
      isNew: true,
    });
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        {
          name: 'protected-skill',
          type: 'artefact',
          url: 'https://cdn.example.com/protected-skill.zip',
        },
      ],
    };

    const result = await resolveDiscoverySkills(doc, 'discovery-token');

    expect(result.errors).toHaveLength(0);
    expect(downloadArtefact).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'artefact',
        artefactUrl: 'https://cdn.example.com/protected-skill.zip',
      }),
      { bearerToken: 'discovery-token' },
    );
  });

  it('collects errors without failing the entire resolution', async () => {
    const { importGitSkills } = await import('../../../src/discovery/git-importer.js');
    vi.mocked(importGitSkills).mockRejectedValueOnce(new Error('Clone failed'));

    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bad-repo', type: 'git', url: 'https://github.com/example/bad.git' },
        { name: 'good-repo', type: 'git', url: 'https://github.com/example/good.git' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source.name).toBe('bad-repo');
    expect(result.errors[0]!.error).toBe('Clone failed');
    expect(result.skills).toHaveLength(1);
  });

  it('calls onProgress callback for each source', async () => {
    const progress: string[] = [];
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bundle', type: 'http', url: 'https://cdn.example.com/bundle' },
        { name: 'repo', type: 'git', url: 'https://github.com/example/repo.git' },
      ],
    };

    await resolveDiscoverySkills(doc, undefined, (msg) => progress.push(msg));
    expect(progress).toHaveLength(2);
    expect(progress[0]).toContain('bundle');
    expect(progress[1]).toContain('repo');
  });

  it('returns empty skills for an empty discovery document', async () => {
    const doc: DiscoveryDocument = { version: '1', sources: [] };
    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('tags artefact integrity errors with isIntegrity: true', async () => {
    const { downloadArtefact } = await import('../../../src/bundle/artefact-downloader.js');
    const { IntegrityError } = await import('../../../src/bundle/downloader.js');

    vi.mocked(downloadArtefact).mockRejectedValueOnce(
      new IntegrityError('expected-hash', 'actual-hash'),
    );

    const doc: DiscoveryDocument = {
      version: '1',
      sources: [{ name: 'bad-artefact', type: 'artefact', url: 'https://cdn.example.com/skill.zip' }],
    };

    const result = await resolveDiscoverySkills(doc);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source.name).toBe('bad-artefact');
    expect(result.errors[0]!.isIntegrity).toBe(true);
    expect(result.skills).toHaveLength(0);
  });

  it('tags resolved skills with source name, type, and status', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'official-repo', type: 'git', url: 'https://github.com/example/repo.git', status: 'official' },
        { name: 'community-bundle', type: 'http', url: 'https://cdn.example.com/bundle', status: 'community' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(2);

    const gitSkill = result.skills.find((s) => s.dirName === 'git-skill-a')!;
    expect(gitSkill.sourceName).toBe('official-repo');
    expect(gitSkill.sourceType).toBe('git');
    expect(gitSkill.sourceStatus).toBe('official');

    const httpSkill = result.skills.find((s) => s.dirName === 'http-skill-a')!;
    expect(httpSkill.sourceName).toBe('community-bundle');
    expect(httpSkill.sourceType).toBe('http');
    expect(httpSkill.sourceStatus).toBe('community');
  });

  it('omits sourceStatus when the discovery source has no status', async () => {
    const doc: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'unlabeled-repo', type: 'git', url: 'https://github.com/example/repo.git' },
      ],
    };

    const result = await resolveDiscoverySkills(doc);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.sourceName).toBe('unlabeled-repo');
    expect(result.skills[0]!.sourceStatus).toBeUndefined();
    expect('sourceStatus' in result.skills[0]!).toBe(false);
  });

  it('does not tag non-integrity errors with isIntegrity', async () => {
    const { importGitSkills } = await import('../../../src/discovery/git-importer.js');
    vi.mocked(importGitSkills).mockRejectedValueOnce(new Error('network failure'));

    const doc: DiscoveryDocument = {
      version: '1',
      sources: [{ name: 'bad-repo', type: 'git', url: 'https://github.com/example/bad.git' }],
    };

    const result = await resolveDiscoverySkills(doc);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.isIntegrity).toBe(false);
  });

  it('keeps two sources on one origin as distinct streams and install identities', async () => {
    const { downloadBundle } = await import('../../../src/bundle/downloader.js');
    const { extractBundle } = await import('../../../src/bundle/extractor.js');
    const { scanBundle } = await import('../../../src/bundle/scanner.js');
    const { deriveSkillInstallKey } = await import('../../../src/bundle/skill-source.js');

    vi.mocked(downloadBundle)
      .mockResolvedValueOnce({ zipPath: '/tmp/team-a.zip', version: '1.0.0', sha256: null })
      .mockResolvedValueOnce({ zipPath: '/tmp/team-b.zip', version: '1.0.0', sha256: null });
    vi.mocked(extractBundle)
      .mockResolvedValueOnce({
        bundleDir: '/tmp/bundles/team-a',
        manifest: { version: '1.0.0', agents: [] },
        isNew: true,
      })
      .mockResolvedValueOnce({
        bundleDir: '/tmp/bundles/team-b',
        manifest: { version: '1.0.0', agents: [] },
        isNew: true,
      });
    vi.mocked(scanBundle)
      .mockResolvedValueOnce({
        skills: [{ ...mockBundleSkills[0]!, dirPath: '/tmp/bundles/team-a/http-skill-a' }],
        rovoAgents: [],
      })
      .mockResolvedValueOnce({
        skills: [{ ...mockBundleSkills[0]!, dirPath: '/tmp/bundles/team-b/http-skill-a' }],
        rovoAgents: [],
      });

    const result = await resolveDiscoverySkills({
      version: '1',
      sources: [
        {
          name: 'team-a',
          type: 'http',
          url: 'https://content.example.com/catalogues/team-a',
        },
        {
          name: 'team-b',
          type: 'http',
          url: 'https://content.example.com/catalogues/team-b',
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.skills.map((skill) => skill.dirPath)).toEqual([
      '/tmp/bundles/team-a/http-skill-a',
      '/tmp/bundles/team-b/http-skill-a',
    ]);
    const identities = result.skills.map(deriveSkillInstallKey);
    expect(identities[0]).not.toBe(identities[1]);
    expect(identities.every((identity) => identity.endsWith('/http-skill-a'))).toBe(true);
  });
});
