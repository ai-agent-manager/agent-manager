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

vi.mock('../../../src/bundle/downloader.js', () => ({
  downloadBundle: vi.fn(async () => ({
    zipPath: '/tmp/bundle.zip',
    version: '1.0.0',
  })),
}));

vi.mock('../../../src/bundle/extractor.js', () => ({
  extractBundle: vi.fn(async () => ({
    bundleDir: '/tmp/bundles',
    manifest: { version: '1.0.0', agents: [] },
    isNew: true,
  })),
}));

vi.mock('../../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(async () => ({
    skills: mockBundleSkills,
    agents: [],
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
    expect(result.bundleVersion).toBe('1.0.0');
    expect(result.errors).toHaveLength(0);
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
});
