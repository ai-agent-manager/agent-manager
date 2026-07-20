import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseHeadlessConfig, buildPinForDirectorySource, runHeadless } from '../../src/headless.js';

vi.mock('../../src/bundle/source.js', () => ({
  resolveSource: vi.fn(async () => ({
    type: 'discovery',
    discovery: {
      version: '1' as const,
      sources: [{ name: 'test-artefact', type: 'artefact', url: 'https://cdn.example.com/skill.zip' }],
    },
  })),
}));

vi.mock('../../src/discovery/index.js', () => ({
  resolveDiscoverySkills: vi.fn(),
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
});
