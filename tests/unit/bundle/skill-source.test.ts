import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  isArtefactUrl,
  isRepoSource,
  isArtefactSource,
  isBundleSource,
  resolveSkillSource,
  buildSourcePin,
  describeSkillSource,
  sanitiseNamespaceSegment,
  deriveRepoNamespace,
  deriveArtefactNamespace,
  deriveBundleSourceNamespace,
  deriveInstallNamespace,
  buildInstallKey,
  flattenNamespace,
  buildLinkName,
  type RepoSkillSource,
  type ArtefactSkillSource,
  type BundleSkillSource,
} from '../../../src/bundle/skill-source.js';

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

  it('preserves scheme and non-standard port in repoUrl for GHES with custom port', async () => {
    const result = await resolveSkillSource(
      'https://github.acme-corp.com:8443/my-org/my-repo',
      { githubHosts: ['github.acme-corp.com'] },
    );
    const r = result as RepoSkillSource;
    expect(r.repoUrl).toBe('https://github.acme-corp.com:8443/my-org/my-repo');
  });

  it('warns but still resolves the ref when /tree/<ref>/<path> has trailing segments', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await resolveSkillSource('https://github.com/org/repo/tree/main/skills/my-skill');
    const r = result as RepoSkillSource;
    expect(r.ref).toBe('main');
    expect(r.repoUrl).toBe('https://github.com/org/repo');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('path after the ref'));
    warnSpy.mockRestore();
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

  it('resolves a GitHub release-asset .zip URL to an artefact source, not a repo source', async () => {
    const result = await resolveSkillSource(
      'https://github.com/org/repo/releases/download/v1.0/skill.zip',
    );
    expect(result.type).toBe('artefact');
    expect((result as ArtefactSkillSource).artefactUrl).toBe(
      'https://github.com/org/repo/releases/download/v1.0/skill.zip',
    );
  });

  it('rejects plain http artefact URLs', async () => {
    await expect(resolveSkillSource('http://cdn.example.com/skill.zip')).rejects.toThrow(
      'Artefact sources must use https',
    );
  });

  it('allows http artefact URLs on localhost for development', async () => {
    const result = await resolveSkillSource('http://localhost:8080/agents/my-skill-1.0.0.zip');
    expect(result.type).toBe('artefact');
  });

  it('allows http artefact URLs on 127.0.0.1 for development', async () => {
    const result = await resolveSkillSource('http://127.0.0.1:8080/my-skill.zip');
    expect(result.type).toBe('artefact');
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
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'skill-source-test-'));
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

  it('preserves sha256 and version in an artefact pin', () => {
    const source: ArtefactSkillSource = {
      type: 'artefact',
      artefactUrl: 'https://cdn.example.com/skills/my-skill/1.2.0/my-skill.zip',
      sha256: 'a'.repeat(64),
      version: '1.2.0',
      installLayout: 'namespaced',
    };
    const pin = buildSourcePin(source);
    expect(pin.sourceType).toBe('artefact');
    expect(pin.sha256).toBe('a'.repeat(64));
    expect(pin.artefactVersion).toBe('1.2.0');
  });

  it('builds a pin for a bundle URL source with bundleVersion', async () => {
    const source = await resolveSkillSource('https://cdn.example.com/agents');
    const pin = buildSourcePin(source, '2026.05.01');
    expect(pin.sourceType).toBe('bundle');
    expect(pin.installLayout).toBe('flat');
    expect(pin.bundleVersion).toBe('2026.05.01');
    expect(pin.bundleBaseUrl).toBe('https://cdn.example.com/agents');
    expect(pin.bundleSourceName).toBeUndefined();
  });

  // Closes the update round trip: manage.ts hands the migrated URL to
  // installFromBundle, which re-pins through here — so the marker has to be
  // written, or the next update suffixes the same pin again.
  it('marks every bundle pin that has a URL as content-root addressed', async () => {
    const fromUrl = buildSourcePin(
      { type: 'bundle', baseUrl: 'https://cdn.example.com/agents', installLayout: 'flat' },
      '1.0.0',
    );
    expect(fromUrl.bundleAddressing).toBe('content-root');

    const resolved = await resolveSkillSource('https://cdn.example.com/catalogue');
    expect(buildSourcePin(resolved, '1.0.0').bundleAddressing).toBe('content-root');
  });

  it('leaves a directory-sourced pin unmarked, since it addresses no URL', () => {
    const pin = buildSourcePin(
      { type: 'bundle', dirPath: '/tmp/my-bundle', installLayout: 'flat' },
      'dev',
    );
    expect(pin.bundleAddressing).toBeUndefined();
    expect(pin.bundleBaseUrl).toBeUndefined();
  });

  it('records the declared source name and canonical content root in a namespaced bundle pin', () => {
    const source: BundleSkillSource = {
      type: 'bundle',
      baseUrl: 'HTTPS://EXAMPLE.COM:443/catalogues/team-a/#ignored',
      sourceName: 'team-a',
      installLayout: 'namespaced',
    };
    const pin = buildSourcePin(source, '1.2.3');
    expect(pin.bundleSourceName).toBe('team-a');
    expect(pin.bundleBaseUrl).toBe('https://example.com/catalogues/team-a');
    expect(pin.installLayout).toBe('namespaced');
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


// ── sanitiseNamespaceSegment ──────────────────────────────────────────────────

describe('sanitiseNamespaceSegment', () => {
  it('lowercases input', () => {
    expect(sanitiseNamespaceSegment('MyOrg')).toBe('myorg');
  });

  it('replaces disallowed special characters with hyphens', () => {
    expect(sanitiseNamespaceSegment('my!org@name')).toBe('my-org-name');
  });

  it('strips leading hyphens', () => {
    expect(sanitiseNamespaceSegment('---my-org')).toBe('my-org');
  });

  it('strips trailing hyphens', () => {
    expect(sanitiseNamespaceSegment('my-org---')).toBe('my-org');
  });

  it('returns "unknown" for an empty string', () => {
    expect(sanitiseNamespaceSegment('')).toBe('unknown');
  });

  it('returns "unknown" for a string that is all special characters', () => {
    expect(sanitiseNamespaceSegment('!!!')).toBe('unknown');
  });

  it('preserves dots and underscores', () => {
    expect(sanitiseNamespaceSegment('my.org_name')).toBe('my.org_name');
  });
});

// ── deriveRepoNamespace ───────────────────────────────────────────────────────

describe('deriveRepoNamespace', () => {
  it('produces host/org/repo for a simple github.com URL', () => {
    expect(deriveRepoNamespace('https://github.com/my-org/my-repo')).toBe('github.com/my-org/my-repo');
  });

  it('strips a .git suffix from the repo segment', () => {
    expect(deriveRepoNamespace('https://github.com/my-org/my-repo.git')).toBe('github.com/my-org/my-repo');
  });

  it('ignores /tree/<ref> path segments beyond org/repo', () => {
    expect(deriveRepoNamespace('https://github.com/my-org/my-repo/tree/main')).toBe('github.com/my-org/my-repo');
  });

  it('includes the GHES hostname for a GitHub Enterprise URL', () => {
    expect(deriveRepoNamespace('https://github.example-internal.com/my-org/my-repo')).toBe(
      'github.example-internal.com/my-org/my-repo',
    );
  });

  it('github.com and GHES with identical org/repo produce different namespaces', () => {
    const publicNs = deriveRepoNamespace('https://github.com/example-org/example-repo');
    const ghesNs = deriveRepoNamespace('https://github.example-internal.com/example-org/example-repo');
    expect(publicNs).not.toBe(ghesNs);
  });

  it('lowercases uppercase org and repo names', () => {
    expect(deriveRepoNamespace('https://github.com/MyOrg/MyRepo')).toBe('github.com/myorg/myrepo');
  });

  it('sanitises special characters in org and repo names', () => {
    expect(deriveRepoNamespace('https://github.com/my org/my!repo')).toBe('github.com/my-org/my-repo');
  });

  // ── Nested repo paths (GitLab subgroups, Gitea orgs, Azure DevOps) ───────────

  it('retains nested path segments so subgroup repos do not collide', () => {
    const a = deriveRepoNamespace('https://gitlab.example.com/group/sub/repo-a');
    const b = deriveRepoNamespace('https://gitlab.example.com/group/sub/repo-b');
    expect(a).toBe('gitlab.example.com/group/sub/repo-a');
    expect(b).toBe('gitlab.example.com/group/sub/repo-b');
    expect(a).not.toBe(b);
  });

  it('strips .git from a single-segment repo path instead of emitting "unknown"', () => {
    expect(deriveRepoNamespace('git://localhost/weird.git')).toBe('localhost/weird');
  });

  it('truncates at a GitLab /-/ web route marker', () => {
    expect(deriveRepoNamespace('https://gitlab.example.com/group/sub/proj/-/tree/main')).toBe(
      'gitlab.example.com/group/sub/proj',
    );
  });

  it('does not truncate a repo whose name happens to be a route-marker word', () => {
    // chromium/src and chromium/tree are distinct real repos; "src" and "tree" are
    // also web-route verbs. Truncating them to just the org collapsed both onto
    // "github.com/chromium" — the same silent collision this whole change prevents.
    const src = deriveRepoNamespace('https://github.com/chromium/src');
    const tree = deriveRepoNamespace('https://github.com/chromium/tree');
    expect(src).toBe('github.com/chromium/src');
    expect(tree).toBe('github.com/chromium/tree');
    expect(src).not.toBe(tree);
  });

  it('still truncates a real /tree/<ref> route on a repo named after a marker word', () => {
    // The repo IS named "src", yet the trailing /tree/main is a genuine route and
    // must still collapse to the repo — the position-2 floor handles both at once.
    expect(deriveRepoNamespace('https://github.com/chromium/src/tree/main')).toBe(
      'github.com/chromium/src',
    );
  });

  it('truncates a marker route page that sits as the last path segment', () => {
    expect(deriveRepoNamespace('https://github.com/org/repo/releases')).toBe('github.com/org/repo');
  });

  it('keeps a non-default port distinct from the default-port host', () => {
    const ported = deriveRepoNamespace('https://github.acme-corp.com:8443/my-org/my-repo');
    const plain = deriveRepoNamespace('https://github.acme-corp.com/my-org/my-repo');
    expect(ported).not.toBe(plain);
    expect(ported).toBe('github.acme-corp.com-8443/my-org/my-repo');
  });
});

// ── buildLinkName ─────────────────────────────────────────────────────────────

describe('buildLinkName', () => {
  it('joins namespace and skill id with "~" when within the length limit', () => {
    expect(buildLinkName('github.com/example-org/example-repo', 'my-skill')).toBe(
      'github.com~example-org~example-repo~my-skill',
    );
  });

  it('keeps a deeply nested link name within the filesystem per-name limit', () => {
    const deep = ['host.example.com', ...Array.from({ length: 40 }, (_, i) => `segment-number-${i}`)].join('/');
    const link = buildLinkName(deep, 'my-skill');
    expect(link.length).toBeLessThanOrEqual(200);
    expect(link.endsWith('~my-skill')).toBe(true);
  });

  it('two different over-long namespaces still produce different link names', () => {
    const base = Array.from({ length: 40 }, (_, i) => `segment-number-${i}`).join('/');
    const a = buildLinkName(`host.example.com/${base}/repo-a`, 'my-skill');
    const b = buildLinkName(`host.example.com/${base}/repo-b`, 'my-skill');
    expect(a.length).toBeLessThanOrEqual(200);
    expect(b.length).toBeLessThanOrEqual(200);
    expect(a).not.toBe(b);
  });
});

// ── deriveArtefactNamespace ───────────────────────────────────────────────────

describe('deriveArtefactNamespace', () => {
  it('produces host/artefact-name for a versioned URL', () => {
    expect(deriveArtefactNamespace('https://cdn.example.com/skills/my-skill/1.2.0/my-skill-1.2.0.zip')).toBe(
      'cdn.example.com/my-skill',
    );
  });

  it('produces host/artefact-name for a URL with version in parent segment', () => {
    expect(deriveArtefactNamespace('https://cdn.example.com/skills/my-skill/1.2.0/skill.zip')).toBe(
      'cdn.example.com/skill',
    );
  });

  it('lowercases the hostname', () => {
    expect(deriveArtefactNamespace('https://CDN.EXAMPLE.COM/my-skill-1.0.0.zip')).toBe(
      'cdn.example.com/my-skill',
    );
  });

  it('produces host/filename-without-extension for a zip at the URL root', () => {
    expect(deriveArtefactNamespace('https://cdn.example.com/my-skill.zip')).toBe('cdn.example.com/my-skill');
  });

  it('two different versions of the same skill share the same namespace', () => {
    const ns1 = deriveArtefactNamespace('https://cdn.example.com/my-skill-1.0.0.zip');
    const ns2 = deriveArtefactNamespace('https://cdn.example.com/my-skill-2.0.0.zip');
    expect(ns1).toBe(ns2);
  });

  it('lowercases the artefact name segment — case-differing filenames collide intentionally', () => {
    const ns1 = deriveArtefactNamespace('https://cdn.example.com/MyApp.zip');
    const ns2 = deriveArtefactNamespace('https://cdn.example.com/myapp.zip');
    expect(ns1).toBe(ns2);
    expect(ns1).toBe('cdn.example.com/myapp');
  });

  // ── GitHub release-asset URLs keep owner/repo in the namespace ───────────────

  it('keeps owner/repo for a GitHub release-asset URL', () => {
    expect(
      deriveArtefactNamespace('https://github.com/example-org/tools/releases/download/v1.0.0/skills.zip'),
    ).toBe('github.com/example-org/tools/skills');
  });

  it('two different owners publishing the same release-asset filename get distinct namespaces', () => {
    const ns1 = deriveArtefactNamespace('https://github.com/alice/tools/releases/download/v1.0.0/skills.zip');
    const ns2 = deriveArtefactNamespace('https://github.com/mallory/other/releases/download/v2.0.0/skills.zip');
    expect(ns1).not.toBe(ns2);
    expect(ns1).toBe('github.com/alice/tools/skills');
    expect(ns2).toBe('github.com/mallory/other/skills');
  });

  it('the same owner/repo across different release tags shares one namespace (version upgrade)', () => {
    const ns1 = deriveArtefactNamespace('https://github.com/alice/tools/releases/download/v1.0.0/skills.zip');
    const ns2 = deriveArtefactNamespace('https://github.com/alice/tools/releases/download/v2.0.0/skills.zip');
    expect(ns1).toBe(ns2);
  });

  it('recognises the release-asset path shape on a non-github (e.g. GHES) host too', () => {
    expect(
      deriveArtefactNamespace(
        'https://github.example-internal.com/example-org/tools/releases/download/v1.0.0/skills.zip',
      ),
    ).toBe('github.example-internal.com/example-org/tools/skills');
  });
});

// ── deriveInstallNamespace ────────────────────────────────────────────────────

describe('deriveInstallNamespace', () => {
  it('returns namespace for a repo source pin with namespaced layout', () => {
    const ns = deriveInstallNamespace({
      sourceType: 'repo',
      installLayout: 'namespaced',
      repoUrl: 'https://github.com/my-org/my-repo',
      ref: 'main',
    });
    expect(ns).toBe('github.com/my-org/my-repo');
  });

  it('returns namespace for an artefact source pin with namespaced layout', () => {
    const ns = deriveInstallNamespace({
      sourceType: 'artefact',
      installLayout: 'namespaced',
      artefactUrl: 'https://cdn.example.com/my-skill-1.0.0.zip',
    });
    expect(ns).toBe('cdn.example.com/my-skill');
  });

  it('returns null for a bundle source pin', () => {
    const ns = deriveInstallNamespace({
      sourceType: 'bundle',
      installLayout: 'flat',
      bundleVersion: '2026.05.01',
    });
    expect(ns).toBeNull();
  });

  it('uses the declared source name alone as the namespace for HTTP bundles', () => {
    expect(deriveBundleSourceNamespace('team-a')).toBe('team-a');
    expect(deriveBundleSourceNamespace('My Team Skills')).toBe('my-team-skills');
    expect(() => deriveBundleSourceNamespace('///')).toThrow('no usable characters');
  });

  it('keeps the namespace stable when a source moves to a different host', () => {
    const before = deriveInstallNamespace({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleSourceName: 'team-a',
      bundleBaseUrl: 'https://content.example.com/catalogues/team-a',
    });
    const afterMove = deriveInstallNamespace({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleSourceName: 'team-a',
      bundleBaseUrl: 'https://cdn.elsewhere.example/renamed-repo',
    });

    expect(before).toBe('team-a');
    expect(afterMove).toBe(before);
  });

  it('derives distinct install namespaces for two sources on one origin', () => {
    const a = deriveInstallNamespace({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleSourceName: 'team-a',
      bundleBaseUrl: 'https://content.example.com/catalogues/team-a',
    });
    const b = deriveInstallNamespace({
      sourceType: 'bundle',
      installLayout: 'namespaced',
      bundleSourceName: 'team-b',
      bundleBaseUrl: 'https://content.example.com/catalogues/team-b',
    });

    expect(a).toBe('team-a');
    expect(b).toBe('team-b');
  });

  it('returns null when installLayout is flat regardless of source type', () => {
    const ns = deriveInstallNamespace({
      sourceType: 'repo',
      installLayout: 'flat',
      repoUrl: 'https://github.com/my-org/my-repo',
    });
    expect(ns).toBeNull();
  });

  it('returns null for a repo pin missing repoUrl', () => {
    const ns = deriveInstallNamespace({
      sourceType: 'repo',
      installLayout: 'namespaced',
    });
    expect(ns).toBeNull();
  });
});

// ── buildInstallKey ───────────────────────────────────────────────────────────

describe('buildInstallKey', () => {
  it('returns namespace/skillDirName when namespace is provided', () => {
    expect(buildInstallKey('github.com/my-org/my-repo', 'my-skill')).toBe(
      'github.com/my-org/my-repo/my-skill',
    );
  });

  it('returns bare skillDirName when namespace is null', () => {
    expect(buildInstallKey(null, 'my-skill')).toBe('my-skill');
  });
});

// ── flattenNamespace ──────────────────────────────────────────────────────────

describe('flattenNamespace', () => {
  it('replaces "/" with "~" (segment separator)', () => {
    expect(flattenNamespace('github.com/org/repo')).toBe('github.com~org~repo');
  });

  it('preserves "." — dots are valid in filenames and are not a separator', () => {
    expect(flattenNamespace('cdn.example.com/my-skill')).toBe('cdn.example.com~my-skill');
  });

  it('leaves "-" within segments unchanged — sanitiseNamespaceSegment never emits "~"', () => {
    expect(flattenNamespace('github.example-internal.com/org/repo')).toBe('github.example-internal.com~org~repo');
  });

  it('is injective for the canonical colliding pair — old "-" encoding was not', () => {
    const a = flattenNamespace('github.com/acme/data-pipeline');
    const b = flattenNamespace('github.com/acme-data/pipeline');
    expect(a).toBe('github.com~acme~data-pipeline');
    expect(b).toBe('github.com~acme-data~pipeline');
    expect(a).not.toBe(b);
  });

  it('produces a filesystem-safe token with no colons or slashes', () => {
    const result = flattenNamespace('github.com/example-org/example-repo');
    expect(result).toBe('github.com~example-org~example-repo');
    expect(result).not.toContain(':');
    expect(result).not.toContain('/');
  });
});
