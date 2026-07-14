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
});
