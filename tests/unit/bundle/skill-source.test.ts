import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  isGithubRepoUrl,
  isArtefactUrl,
  isRepoSource,
  isArtefactSource,
  isBundleSource,
  resolveSkillSource,
  buildSourcePin,
  describeSkillSource,
  GITHUB_HOSTS_DEFAULT,
  type SkillSource,
  type RepoSkillSource,
  type ArtefactSkillSource,
  type BundleSkillSource,
} from '../../../src/bundle/skill-source.js';

// ── isGithubRepoUrl ───────────────────────────────────────────────────────────

describe('isGithubRepoUrl', () => {
  it('returns true for a simple org/repo URL', () => {
    expect(isGithubRepoUrl('https://github.com/org/repo')).toBe(true);
  });

  it('returns true for a URL with a /tree/<ref> path', () => {
    expect(isGithubRepoUrl('https://github.com/org/repo/tree/main')).toBe(true);
  });

  it('returns true for a URL with trailing slash', () => {
    expect(isGithubRepoUrl('https://github.com/org/repo/')).toBe(true);
  });

  it('returns false for github.com with only one path segment (org only)', () => {
    expect(isGithubRepoUrl('https://github.com/org')).toBe(false);
  });

  it('returns false for a non-GitHub URL', () => {
    expect(isGithubRepoUrl('https://example.com/org/repo')).toBe(false);
  });

  it('returns false for a CDN URL', () => {
    expect(isGithubRepoUrl('https://cdn.example.com/skills/my-skill.zip')).toBe(false);
  });

  it('returns false for an invalid URL string', () => {
    expect(isGithubRepoUrl('not-a-url')).toBe(false);
  });

  it('GITHUB_HOSTS_DEFAULT contains only github.com', () => {
    expect(GITHUB_HOSTS_DEFAULT).toEqual(['github.com']);
  });

  it('returns false for a GHES hostname when using default hosts', () => {
    expect(isGithubRepoUrl('https://github.acme-corp.com/org/repo')).toBe(false);
  });

  it('returns true for a GHES hostname when passed as a custom knownHost', () => {
    expect(isGithubRepoUrl('https://github.acme-corp.com/org/repo', ['github.com', 'github.acme-corp.com'])).toBe(true);
  });

  it('returns true for a GHES hostname when it is the only entry in knownHosts', () => {
    expect(isGithubRepoUrl('https://github.acme-corp.com/org/repo', ['github.acme-corp.com'])).toBe(true);
  });
});

// ── isArtefactUrl ─────────────────────────────────────────────────────────────

describe('isArtefactUrl', () => {
  it('returns true for a .zip URL', () => {
    expect(isArtefactUrl('https://cdn.example.com/skills/my-skill/1.0.0/skill.zip')).toBe(true);
  });

  it('returns true for a .zip URL with a query string', () => {
    expect(isArtefactUrl('https://cdn.example.com/skill.zip?token=abc')).toBe(true);
  });

  it('returns true for an uppercase .ZIP URL', () => {
    expect(isArtefactUrl('https://cdn.example.com/MY-SKILL.ZIP')).toBe(true);
  });

  it('returns false for a non-zip URL', () => {
    expect(isArtefactUrl('https://cdn.example.com/bundle')).toBe(false);
  });

  it('returns false for a GitHub repo URL', () => {
    expect(isArtefactUrl('https://github.com/org/repo')).toBe(false);
  });

  it('returns false for an invalid string', () => {
    expect(isArtefactUrl('not-a-url')).toBe(false);
  });
});

// ── type guards ───────────────────────────────────────────────────────────────

describe('type guards', () => {
  const repo: RepoSkillSource = { type: 'repo', repoUrl: 'https://github.com/org/repo', installLayout: 'namespaced' };
  const artefact: ArtefactSkillSource = { type: 'artefact', artefactUrl: 'https://cdn.example.com/skill.zip', installLayout: 'namespaced' };
  const bundle: BundleSkillSource = { type: 'bundle', baseUrl: 'https://cdn.example.com', installLayout: 'flat' };

  it('isRepoSource correctly identifies repo source', () => {
    expect(isRepoSource(repo)).toBe(true);
    expect(isRepoSource(artefact)).toBe(false);
    expect(isRepoSource(bundle)).toBe(false);
  });

  it('isArtefactSource correctly identifies artefact source', () => {
    expect(isArtefactSource(artefact)).toBe(true);
    expect(isArtefactSource(repo)).toBe(false);
    expect(isArtefactSource(bundle)).toBe(false);
  });

  it('isBundleSource correctly identifies bundle source', () => {
    expect(isBundleSource(bundle)).toBe(true);
    expect(isBundleSource(repo)).toBe(false);
    expect(isBundleSource(artefact)).toBe(false);
  });
});

// ── resolveSkillSource ────────────────────────────────────────────────────────

describe('resolveSkillSource — GitHub repo URLs', () => {
  it('resolves a GitHub org/repo URL to a repo source with default branch', async () => {
    const result = await resolveSkillSource('https://github.com/my-org/my-repo');
    expect(result.type).toBe('repo');
    const r = result as RepoSkillSource;
    expect(r.repoUrl).toBe('https://github.com/my-org/my-repo');
    expect(r.ref).toBe('main');
    expect(r.defaultBranch).toBe('main');
    expect(r.installLayout).toBe('namespaced');
  });

  it('respects options.defaultBranch', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo', { defaultBranch: 'develop' });
    const r = result as RepoSkillSource;
    expect(r.ref).toBe('develop');
    expect(r.defaultBranch).toBe('develop');
  });

  it('extracts a pinned ref from /tree/<ref> path', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo/tree/v2.0.0');
    const r = result as RepoSkillSource;
    expect(r.repoUrl).toBe('https://github.com/org/repo');
    expect(r.ref).toBe('v2.0.0');
  });

  it('does NOT extract a ref from a non-tree path (e.g. /issues/5)', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo/issues/5');
    const r = result as RepoSkillSource;
    // /issues/5 should NOT be treated as a pinned ref — falls back to defaultBranch
    expect(r.repoUrl).toBe('https://github.com/org/repo');
    expect(r.ref).toBe('main');
  });

  it('does NOT extract a ref from a /blob/ path', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo/blob/main/README.md');
    const r = result as RepoSkillSource;
    // /blob/ is not /tree/, so ref falls back to defaultBranch
    expect(r.ref).toBe('main');
    expect(r.repoUrl).toBe('https://github.com/org/repo');
  });

  it('respects options.skillPath', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo', { skillPath: 'skills/my-skill' });
    const r = result as RepoSkillSource;
    expect(r.skillPath).toBe('skills/my-skill');
  });

  it('uses installLayout from options when provided', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo', { installLayout: 'flat' });
    expect((result as RepoSkillSource).installLayout).toBe('flat');
  });

  it('defaults installLayout to namespaced for repo sources', async () => {
    const result = await resolveSkillSource('https://github.com/org/repo');
    expect((result as RepoSkillSource).installLayout).toBe('namespaced');
  });

  it('resolves a GHES URL to a repo source when githubHosts includes the GHES hostname', async () => {
    const result = await resolveSkillSource(
      'https://github.acme-corp.com/my-org/my-repo',
      { githubHosts: ['github.com', 'github.acme-corp.com'] },
    );
    expect(result.type).toBe('repo');
    const r = result as RepoSkillSource;
    expect(r.repoUrl).toBe('https://github.acme-corp.com/my-org/my-repo');
    expect(r.ref).toBe('main');
  });

  it('falls through to bundle source for a GHES URL when githubHosts is not configured', async () => {
    // Without custom githubHosts, github.acme-corp.com is not recognised as a repo host
    const result = await resolveSkillSource('https://github.acme-corp.com/my-org/my-repo');
    expect(result.type).toBe('bundle');
    const b = result as BundleSkillSource;
    expect(b.baseUrl).toBe('https://github.acme-corp.com/my-org/my-repo');
  });

  it('respects a custom defaultBranch for GHES repo URL', async () => {
    const result = await resolveSkillSource(
      'https://github.acme-corp.com/my-org/my-repo',
      { githubHosts: ['github.acme-corp.com'], defaultBranch: 'master' },
    );
    const r = result as RepoSkillSource;
    expect(r.ref).toBe('master');
    expect(r.defaultBranch).toBe('master');
  });
});

describe('resolveSkillSource — artefact URLs', () => {
  it('resolves a .zip URL to an artefact source', async () => {
    const result = await resolveSkillSource('https://cdn.example.com/skills/my-skill/1.0.0/skill.zip');
    expect(result.type).toBe('artefact');
    const a = result as ArtefactSkillSource;
    expect(a.artefactUrl).toBe('https://cdn.example.com/skills/my-skill/1.0.0/skill.zip');
    expect(a.installLayout).toBe('namespaced');
  });

  it('defaults installLayout to namespaced for artefact sources', async () => {
    const result = await resolveSkillSource('https://cdn.example.com/skill.zip');
    expect((result as ArtefactSkillSource).installLayout).toBe('namespaced');
  });

  it('uses installLayout from options for artefact sources', async () => {
    const result = await resolveSkillSource('https://cdn.example.com/skill.zip', { installLayout: 'flat' });
    expect((result as ArtefactSkillSource).installLayout).toBe('flat');
  });
});

describe('resolveSkillSource — bundle (legacy) URLs', () => {
  it('resolves a non-GitHub, non-zip URL to a bundle source', async () => {
    const result = await resolveSkillSource('https://cdn.example.com/agents');
    expect(result.type).toBe('bundle');
    const b = result as BundleSkillSource;
    expect(b.baseUrl).toBe('https://cdn.example.com/agents');
    expect(b.dirPath).toBeUndefined();
  });

  it('defaults installLayout to flat for bundle URL sources', async () => {
    const result = await resolveSkillSource('https://cdn.example.com/agents');
    expect((result as BundleSkillSource).installLayout).toBe('flat');
  });
});

describe('resolveSkillSource — local directory paths', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `skill-source-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resolves an existing directory to a bundle source with dirPath', async () => {
    const result = await resolveSkillSource(tempDir);
    expect(result.type).toBe('bundle');
    const b = result as BundleSkillSource;
    expect(b.dirPath).toBe(tempDir);
    expect(b.baseUrl).toBeUndefined();
    expect(b.installLayout).toBe('flat');
  });

  it('resolves a relative path to an absolute dirPath', async () => {
    const subDir = path.join(tempDir, 'sub');
    await mkdir(subDir, { recursive: true });
    // resolveSkillSource resolves relative to cwd; use absolute path here
    const result = await resolveSkillSource(subDir);
    const b = result as BundleSkillSource;
    expect(path.isAbsolute(b.dirPath!)).toBe(true);
  });

  it('throws for a non-existent path', async () => {
    const badPath = path.join(tempDir, 'does-not-exist');
    await expect(resolveSkillSource(badPath)).rejects.toThrow('Path does not exist');
  });

  it('throws for a path that is a file, not a directory', async () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');
    await expect(resolveSkillSource(filePath)).rejects.toThrow('Path is not a directory');
  });
});

describe('resolveSkillSource — invalid inputs', () => {
  it('throws for an invalid URL', async () => {
    await expect(resolveSkillSource('https://')).rejects.toThrow();
  });
});

// ── buildSourcePin ────────────────────────────────────────────────────────────

describe('buildSourcePin', () => {
  it('builds a pin for a repo source', async () => {
    const source = await resolveSkillSource('https://github.com/org/repo', { skillPath: 'skills/my-skill' });
    const pin = buildSourcePin(source);
    expect(pin.sourceType).toBe('repo');
    expect(pin.installLayout).toBe('namespaced');
    expect(pin.repoUrl).toBe('https://github.com/org/repo');
    expect(pin.ref).toBe('main');
    expect(pin.skillPath).toBe('skills/my-skill');
    expect(pin.artefactUrl).toBeUndefined();
    expect(pin.bundleVersion).toBeUndefined();
  });

  it('builds a pin for an artefact source', async () => {
    const source = await resolveSkillSource('https://cdn.example.com/skill.zip');
    const pin = buildSourcePin(source);
    expect(pin.sourceType).toBe('artefact');
    expect(pin.artefactUrl).toBe('https://cdn.example.com/skill.zip');
    expect(pin.repoUrl).toBeUndefined();
    expect(pin.bundleVersion).toBeUndefined();
  });

  it('builds a pin for a bundle URL source with bundleVersion', async () => {
    const source = await resolveSkillSource('https://cdn.example.com/agents');
    const pin = buildSourcePin(source, '2026.05.01');
    expect(pin.sourceType).toBe('bundle');
    expect(pin.installLayout).toBe('flat');
    expect(pin.bundleVersion).toBe('2026.05.01');
    expect(pin.bundleBaseUrl).toBe('https://cdn.example.com/agents');
  });

  it('builds a pin for a bundle directory source', async () => {
    const source: BundleSkillSource = { type: 'bundle', dirPath: '/tmp/my-bundle', installLayout: 'flat' };
    const pin = buildSourcePin(source, 'dev-202605010900');
    expect(pin.sourceType).toBe('bundle');
    expect(pin.bundleVersion).toBe('dev-202605010900');
    expect(pin.bundleBaseUrl).toBeUndefined();
  });
});

// ── describeSkillSource ───────────────────────────────────────────────────────

describe('describeSkillSource', () => {
  it('describes a repo source with ref', () => {
    const source: RepoSkillSource = {
      type: 'repo',
      repoUrl: 'https://github.com/org/repo',
      ref: 'v1.2.0',
      installLayout: 'namespaced',
    };
    expect(describeSkillSource(source)).toBe('repo: https://github.com/org/repo@v1.2.0');
  });

  it('describes a repo source with skillPath', () => {
    const source: RepoSkillSource = {
      type: 'repo',
      repoUrl: 'https://github.com/org/repo',
      ref: 'main',
      skillPath: 'skills/my-skill',
      installLayout: 'namespaced',
    };
    expect(describeSkillSource(source)).toBe('repo: https://github.com/org/repo@main (skills/my-skill)');
  });

  it('falls back to defaultBranch when ref is absent', () => {
    const source: RepoSkillSource = {
      type: 'repo',
      repoUrl: 'https://github.com/org/repo',
      defaultBranch: 'develop',
      installLayout: 'namespaced',
    };
    expect(describeSkillSource(source)).toBe('repo: https://github.com/org/repo@develop');
  });

  it('describes an artefact source', () => {
    const source: ArtefactSkillSource = {
      type: 'artefact',
      artefactUrl: 'https://cdn.example.com/skills/my-skill/1.0.0/skill.zip',
      installLayout: 'namespaced',
    };
    expect(describeSkillSource(source)).toBe('artefact: https://cdn.example.com/skills/my-skill/1.0.0/skill.zip');
  });

  it('describes a bundle URL source', () => {
    const source: BundleSkillSource = {
      type: 'bundle',
      baseUrl: 'https://cdn.example.com/agents',
      installLayout: 'flat',
    };
    expect(describeSkillSource(source)).toBe('bundle: https://cdn.example.com/agents');
  });

  it('describes a bundle directory source', () => {
    const source: BundleSkillSource = {
      type: 'bundle',
      dirPath: '/home/user/.agentman/bundles/2026.05.01',
      installLayout: 'flat',
    };
    expect(describeSkillSource(source)).toBe('bundle: /home/user/.agentman/bundles/2026.05.01');
  });

  it('describes a bundle source with neither baseUrl nor dirPath as (local)', () => {
    const source: BundleSkillSource = { type: 'bundle', installLayout: 'flat' };
    expect(describeSkillSource(source)).toBe('bundle: (local)');
  });
});
