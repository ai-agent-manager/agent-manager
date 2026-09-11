import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseHeadlessConfig, runHeadless } from '../../src/headless.js';
import { buildPinForDirectorySource } from '../../src/bundle/skill-source.js';

vi.mock('../../src/bundle/skill-source.js', () => ({
  resolveSkillSource: vi.fn(async (input: string) => ({
    type: 'bundle',
    baseUrl: input,
    installLayout: 'flat' as const,
  })),
  isRepoSource: vi.fn((s) => s.type === 'repo'),
  isArtefactSource: vi.fn((s) => s.type === 'artefact'),
  isBundleSource: vi.fn((s) => s.type === 'bundle'),
  buildSourcePin: vi.fn((s) => ({
    sourceType: s.type,
    installLayout: s.installLayout,
    ...(s.type === 'repo' ? { repoUrl: s.repoUrl, ref: s.ref, skillPath: s.skillPath } : {}),
  })),
  buildPinForDirectorySource: vi.fn((dir, version) => ({
    sourceType: 'bundle',
    bundleVersion: version,
    installLayout: 'flat',
  })),
  deriveSkillInstallKey: vi.fn((skill) => {
    // Match real behavior: derive namespace from sourcePin when present
    if (skill.sourcePin?.sourceType === 'repo' && skill.sourcePin.repoUrl) {
      const url = new URL(skill.sourcePin.repoUrl);
      const segments = url.pathname.split('/').filter(Boolean);
      const namespace = [url.host, ...segments].join('/');
      return `${namespace}/${skill.dirName}`;
    }
    return skill.dirName;
  }),
}));

vi.mock('../../src/discovery/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/discovery/index.js')>(
    '../../src/discovery/index.js',
  );
  return {
    ...actual,
    fetchDiscoveryDocument: vi.fn(async () => ({
      version: '1' as const,
      sources: [{ name: 'test-artefact', type: 'artefact', url: 'https://cdn.example.com/skill.zip' }],
    })),
    resolveDiscoverySkills: vi.fn(),
  };
});

vi.mock('../../src/bundle/downloader.js', () => ({
  downloadBundle: vi.fn(),
}));

vi.mock('../../src/bundle/extractor.js', () => ({
  extractBundle: vi.fn(),
}));

vi.mock('../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(),
}));

vi.mock('../../src/bundle/repo-downloader.js', () => ({
  downloadRepoArchive: vi.fn(),
}));

vi.mock('../../src/bundle/repo-scanner.js', () => ({
  scanRepoForSkills: vi.fn(),
}));

// Hoisted so tests can assert on install's actual call arguments, not just that it fired.
const { installMock } = vi.hoisted(() => ({
  installMock: vi.fn(async () => ({
    installed: [{ name: 'github.com/example-org/repo-a/my-skill', method: 'symlink' as const, path: '/tmp/skills/github.com~example-org~repo-a~my-skill' }],
    errors: [],
  })),
}));

vi.mock('../../src/provisioners/registry.js', () => ({
  createSkillProvisioner: vi.fn(() => ({
    install: installMock,
  })),
  formatSupportedSkillToolIds: vi.fn(() => 'claude-code'),
}));

describe('parseHeadlessConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-headless-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfigFile(content: string): Promise<string> {
    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, content);
    return configPath;
  }

  it('parses a minimal config', async () => {
    const configPath = await writeConfigFile(
      'tools: claude-code\nskills:\n  - my-skill\n',
    );

    const config = await parseHeadlessConfig(configPath);

    expect(config.tools).toEqual(['claude-code']);
    expect(config.scope).toBe('repo');
    expect(config.skills).toEqual(['my-skill']);
    expect(config.artefactSha256).toBeUndefined();
  });

  it('parses a valid artefact-sha256 and lowercases it', async () => {
    const hash = 'A'.repeat(64);
    const configPath = await writeConfigFile(
      `tools: claude-code\nskills:\n  - my-skill\nartefact-sha256: ${hash}\n`,
    );

    const config = await parseHeadlessConfig(configPath);

    expect(config.artefactSha256).toBe('a'.repeat(64));
  });

  it('rejects a malformed artefact-sha256', async () => {
    const configPath = await writeConfigFile(
      'tools: claude-code\nskills:\n  - my-skill\nartefact-sha256: not-a-hash\n',
    );

    await expect(parseHeadlessConfig(configPath)).rejects.toThrow(
      '"artefact-sha256" must be a 64-character hex SHA-256',
    );
  });

  it('rejects an artefact-sha256 of the wrong length', async () => {
    const configPath = await writeConfigFile(
      `tools: claude-code\nskills:\n  - my-skill\nartefact-sha256: ${'a'.repeat(40)}\n`,
    );

    await expect(parseHeadlessConfig(configPath)).rejects.toThrow(
      '"artefact-sha256" must be a 64-character hex SHA-256',
    );
  });

  it('requires tools', async () => {
    const configPath = await writeConfigFile('skills:\n  - my-skill\n');

    await expect(parseHeadlessConfig(configPath)).rejects.toThrow('"tools" is required');
  });

  it('requires a non-empty skills list', async () => {
    const configPath = await writeConfigFile('tools: claude-code\nskills: []\n');

    await expect(parseHeadlessConfig(configPath)).rejects.toThrow(
      '"skills" must be a non-empty list',
    );
  });
});

describe('buildPinForDirectorySource', () => {
  it('pins a directory source as bundle with bundleVersion, no repoUrl or artefactUrl', () => {
    const pin = buildPinForDirectorySource('/local/my-bundle', '2026.07.01');
    expect(pin.sourceType).toBe('bundle');
    expect(pin.installLayout).toBe('flat');
    expect(pin.bundleVersion).toBe('2026.07.01');
    expect(pin.bundleBaseUrl).toBeUndefined();
    expect(pin.repoUrl).toBeUndefined();
    expect(pin.artefactUrl).toBeUndefined();
  });
});

describe('runHeadless', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-headless-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('installs from a GitHub repository without requesting discovery', async () => {
    const { resolveSkillSource } = await import('../../src/bundle/skill-source.js');
    const { fetchDiscoveryDocument } = await import('../../src/discovery/index.js');
    const { downloadRepoArchive } = await import('../../src/bundle/repo-downloader.js');
    const { scanRepoForSkills } = await import('../../src/bundle/repo-scanner.js');
    const repoSource = {
      type: 'repo' as const,
      repoUrl: 'https://github.com/example-org/example-repo',
      defaultBranch: 'main',
      ref: 'main',
      installLayout: 'namespaced' as const,
    };
    const repoSkill = {
      dirName: 'my-skill',
      dirPath: '/tmp/example-repo/skills/my-skill',
      skillMdPath: '/tmp/example-repo/skills/my-skill/SKILL.md',
      meta: null,
    };

    vi.mocked(resolveSkillSource).mockResolvedValueOnce(repoSource);
    vi.mocked(downloadRepoArchive).mockResolvedValueOnce({
      extractDir: '/tmp/example-repo',
      isNew: true,
    });
    vi.mocked(scanRepoForSkills).mockResolvedValueOnce({
      skills: [repoSkill],
      skillsDir: '/tmp/example-repo/skills',
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');
    installMock.mockClear();

    await expect(
      runHeadless('https://github.com/example-org/example-repo', configPath, false),
    ).resolves.toBeUndefined();

    expect(fetchDiscoveryDocument).not.toHaveBeenCalled();
    expect(downloadRepoArchive).toHaveBeenCalledWith(
      repoSource,
      expect.objectContaining({ forceUpdate: false }),
    );
    expect(scanRepoForSkills).toHaveBeenCalledWith('/tmp/example-repo', repoSource);
    expect(installMock).toHaveBeenCalledWith(
      [repoSkill],
      '',
      expect.objectContaining({
        sourceType: 'repo',
        installLayout: 'namespaced',
        repoUrl: repoSource.repoUrl,
        ref: 'main',
      }),
    );
  });

  it('does not partially install from a GitHub repository when a requested skill is missing', async () => {
    const { resolveSkillSource } = await import('../../src/bundle/skill-source.js');
    const { downloadRepoArchive } = await import('../../src/bundle/repo-downloader.js');
    const { scanRepoForSkills } = await import('../../src/bundle/repo-scanner.js');
    const repoSource = {
      type: 'repo' as const,
      repoUrl: 'https://github.com/example-org/example-repo',
      defaultBranch: 'main',
      ref: 'main',
      installLayout: 'namespaced' as const,
    };

    vi.mocked(resolveSkillSource).mockResolvedValueOnce(repoSource);
    vi.mocked(downloadRepoArchive).mockResolvedValueOnce({
      extractDir: '/tmp/example-repo',
      isNew: true,
    });
    vi.mocked(scanRepoForSkills).mockResolvedValueOnce({
      skills: [{
        dirName: 'available-skill',
        dirPath: '/tmp/example-repo/skills/available-skill',
        skillMdPath: '/tmp/example-repo/skills/available-skill/SKILL.md',
        meta: null,
      }],
      skillsDir: '/tmp/example-repo/skills',
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(
      configPath,
      'tools: claude-code\nscope: repo\nskills:\n  - available-skill\n  - missing-skill\n',
    );
    installMock.mockClear();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    await expect(
      runHeadless('https://github.com/example-org/example-repo', configPath, false),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(installMock).not.toHaveBeenCalled();
  });

  it('falls back to a legacy bundle when the discovery document returns 404', async () => {
    const { DiscoveryError, fetchDiscoveryDocument } = await import('../../src/discovery/index.js');
    const { downloadBundle } = await import('../../src/bundle/downloader.js');
    const { extractBundle } = await import('../../src/bundle/extractor.js');
    const { scanBundle } = await import('../../src/bundle/scanner.js');
    vi.mocked(fetchDiscoveryDocument).mockRejectedValueOnce(
      new DiscoveryError('Discovery document not found', 'https://cdn.example.com', undefined, 404),
    );
    vi.mocked(downloadBundle).mockResolvedValueOnce({
      zipPath: '/tmp/bundle.zip',
      version: '1.0.0',
      sha256: null,
    });
    vi.mocked(extractBundle).mockResolvedValueOnce({
      bundleDir: '/tmp/bundle',
      manifest: { version: '1.0.0', published: '2026-08-28' },
      isNew: false,
    });
    vi.mocked(scanBundle).mockResolvedValueOnce({
      skills: [{
        dirName: 'my-skill',
        dirPath: '/tmp/bundle/my-skill',
        skillMdPath: '/tmp/bundle/my-skill/SKILL.md',
        meta: null,
      }],
      rovoAgents: [],
    });
    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');
    installMock.mockClear();

    await expect(runHeadless('https://cdn.example.com', configPath, false)).resolves.toBeUndefined();

    expect(downloadBundle).toHaveBeenCalledWith('https://cdn.example.com', undefined);
    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the discovery document is invalid', async () => {
    const { DiscoveryError, fetchDiscoveryDocument } = await import('../../src/discovery/index.js');
    const { downloadBundle } = await import('../../src/bundle/downloader.js');
    vi.mocked(fetchDiscoveryDocument).mockRejectedValueOnce(
      new DiscoveryError('Discovery document validation failed', 'https://cdn.example.com'),
    );
    vi.mocked(downloadBundle).mockClear();
    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');

    await expect(runHeadless('https://cdn.example.com', configPath, false)).rejects.toThrow(
      'Discovery document validation failed',
    );
    expect(downloadBundle).not.toHaveBeenCalled();
  });

  it('exits non-zero when a requested skill name is ambiguous across sources', async () => {
    const { resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [
        {
          dirName: 'my-skill',
          dirPath: '/tmp/source-a/my-skill',
          skillMdPath: '/tmp/source-a/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/repo-a' },
        },
        {
          dirName: 'my-skill',
          dirPath: '/tmp/source-b/my-skill',
          skillMdPath: '/tmp/source-b/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/repo-b' },
        },
        {
          dirName: 'available-skill',
          dirPath: '/tmp/source-a/available-skill',
          skillMdPath: '/tmp/source-a/available-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/repo-a' },
        },
      ],
      rovoAgents: [],
      errors: [],
      bundleVersion: undefined,
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(
      configPath,
      'tools: claude-code\nscope: repo\nskills:\n  - available-skill\n  - my-skill\n',
    );
    installMock.mockClear();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    await expect(
      runHeadless('https://cdn.example.com/discovery', configPath, false),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(installMock).not.toHaveBeenCalled();
  });

  it('installs successfully when a qualified name is used to disambiguate', async () => {
    const { resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [
        {
          dirName: 'my-skill',
          dirPath: '/tmp/source-a/my-skill',
          skillMdPath: '/tmp/source-a/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/repo-a' },
        },
        {
          dirName: 'my-skill',
          dirPath: '/tmp/source-b/my-skill',
          skillMdPath: '/tmp/source-b/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/repo-b' },
        },
      ],
      rovoAgents: [],
      errors: [],
      bundleVersion: undefined,
    });

    // Use the qualified key for repo-a to disambiguate
    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(
      configPath,
      'tools: claude-code\nscope: repo\nskills:\n  - github.com/example-org/repo-a/my-skill\n',
    );

    installMock.mockClear();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    // Should NOT throw — qualified name resolves unambiguously via exact Map hit
    await expect(
      runHeadless('https://cdn.example.com/discovery', configPath, false),
    ).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();

    // A matcher bug resolving to repo-b's skill would still make install() get called —
    // assert on the actual item installed, not just that install() fired.
    expect(installMock).toHaveBeenCalledTimes(1);
    const [installedItems] = installMock.mock.calls[0];
    expect(installedItems).toHaveLength(1);
    expect(installedItems[0].dirPath).toBe('/tmp/source-a/my-skill');
  });

  it('exits non-zero and does not install when an artefact fails integrity check', async () => {
    const { resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [],
      rovoAgents: [],
      errors: [
        {
          source: { name: 'test-artefact', type: 'artefact', url: 'https://cdn.example.com/skill.zip' },
          error: 'Bundle integrity check failed.',
          isIntegrity: true,
        },
      ],
      bundleVersion: undefined,
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    await expect(
      runHeadless('https://cdn.example.com/discovery', configPath, false),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits non-zero when a bare config entry matches both a flat and a namespaced skill', async () => {
    // A flat (bundle/http) skill and a namespaced (repo) skill share the same bare id.
    // The old fast-path (has(skillName)) would silently install the flat one; the fixed
    // path runs both through the ambiguity check and must fail loudly.
    const { resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [
        {
          dirName: 'my-skill',
          dirPath: '/tmp/bundle/my-skill',
          skillMdPath: '/tmp/bundle/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'bundle' as const, installLayout: 'flat' as const, baseUrl: 'https://cdn.example.com/bundle' },
        },
        {
          dirName: 'my-skill',
          dirPath: '/tmp/repo/my-skill',
          skillMdPath: '/tmp/repo/my-skill/SKILL.md',
          meta: null,
          sourcePin: { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/example-repo' },
        },
      ],
      rovoAgents: [],
      errors: [],
      bundleVersion: undefined,
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called');
    });

    await expect(
      runHeadless('https://cdn.example.com/discovery', configPath, false),
    ).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('warns instead of silently dropping when two sources collapse onto one identity', async () => {
    // Guards the bug class itself: if a namespace-derivation gap ever makes two distinct
    // sources share an install key, the Map must not swallow one of them without a word.
    const { resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    const samePin = { sourceType: 'repo' as const, installLayout: 'namespaced' as const, repoUrl: 'https://github.com/example-org/example-repo' };
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [
        { dirName: 'my-skill', dirPath: '/tmp/source-a/my-skill', skillMdPath: '/tmp/source-a/my-skill/SKILL.md', meta: null, sourcePin: samePin },
        { dirName: 'my-skill', dirPath: '/tmp/source-b/my-skill', skillMdPath: '/tmp/source-b/my-skill/SKILL.md', meta: null, sourcePin: samePin },
      ],
      rovoAgents: [],
      errors: [],
      bundleVersion: undefined,
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installMock.mockClear();

    await expect(
      runHeadless('https://cdn.example.com/discovery', configPath, false),
    ).resolves.toBeUndefined();

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('two sources resolved to the same identity');
    expect(warned).toContain('github.com/example-org/example-repo/my-skill');
    expect(warned).toContain('/tmp/source-a/my-skill');
    expect(warned).toContain('/tmp/source-b/my-skill');
  });

  it('uses AGENTMAN_ACCESS_TOKEN without a host allowlist in headless mode', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');
    const { fetchDiscoveryDocument, resolveDiscoverySkills } = await import('../../src/discovery/index.js');
    vi.mocked(fetchDiscoveryDocument).mockResolvedValueOnce({
      version: '1',
      auth: { required: true },
      sources: [{ name: 'test-artefact', type: 'artefact', url: 'https://cdn.example.com/skill.zip' }],
    });
    vi.mocked(resolveDiscoverySkills).mockResolvedValueOnce({
      skills: [{
        dirName: 'my-skill',
        dirPath: '/tmp/skill/my-skill',
        skillMdPath: '/tmp/skill/my-skill/SKILL.md',
        meta: null,
      }],
      rovoAgents: [],
      errors: [],
      bundleVersion: 'discovery',
    });

    const configPath = path.join(tmpDir, 'ai-skills.yml');
    await writeFile(configPath, 'tools: claude-code\nscope: repo\nskills:\n  - my-skill\n');
    installMock.mockClear();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      runHeadless('https://cdn.example.com', configPath, false),
    ).resolves.toBeUndefined();

    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'Using access token from AGENTMAN_ACCESS_TOKEN',
    );
    expect(resolveDiscoverySkills).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { required: true } }),
      undefined,
      expect.any(Function),
      expect.objectContaining({
        authSession: expect.objectContaining({
          discoveryBaseUrl: 'https://cdn.example.com',
          auth: { required: true },
        }),
      }),
    );
    expect(installMock).toHaveBeenCalledTimes(1);
  });
});
