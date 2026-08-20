/**
 * Update, end to end through the real seam.
 *
 * Everything between updateInstalled and the written config record runs for
 * real — installFromBundle, buildSourcePin, the provisioner, the config write.
 * Only the network and the archive handling are mocked. That boundary is the
 * point: composing mocks at an inner seam is what let a pin be re-recorded
 * without its addressing marker while every unit test still passed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;
let bundleDir: string;

vi.mock('../../../src/lib/platform.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/platform.js')>(
    '../../../src/lib/platform.js',
  );
  return { ...actual, getHomeDir: () => tmpDir };
});

vi.mock('../../../src/bundle/downloader.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/bundle/downloader.js')>(
    '../../../src/bundle/downloader.js',
  );
  return {
    ...actual,
    // The URL this receives is the whole point of the test.
    downloadBundle: vi.fn(async () => ({ zipPath: '/tmp/bundle.zip', version: '1.1.0', sha256: null })),
  };
});

vi.mock('../../../src/bundle/extractor.js', () => ({
  extractBundle: vi.fn(async () => ({
    manifest: { version: '1.1.0', agents: [] },
    bundleDir,
    isNew: true,
  })),
}));

vi.mock('../../../src/bundle/scanner.js', () => ({
  scanBundle: vi.fn(async () => ({
    skills: [
      {
        dirName: 'react-skill',
        dirPath: path.join(bundleDir, 'react-skill'),
        skillMdPath: path.join(bundleDir, 'react-skill', 'SKILL.md'),
        meta: null,
      },
    ],
    rovoAgents: [],
  })),
}));

const { updateInstalled } = await import('../../../src/operations/manage.js');
const { recordInstall, readConfig } = await import('../../../src/bundle/cache.js');
const { downloadBundle } = await import('../../../src/bundle/downloader.js');

async function pinOf(): Promise<Record<string, unknown>> {
  const config = await readConfig();
  const record = Object.values(config.installations['claude-code']!)[0]!;
  return record.sourcePin as unknown as Record<string, unknown>;
}

describe('updateInstalled — full round trip', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-update-rt-'));
    bundleDir = path.join(tmpDir, 'bundle');
    await mkdir(path.join(bundleDir, 'react-skill'), { recursive: true });
    await writeFile(path.join(bundleDir, 'react-skill', 'SKILL.md'), '# skill\n', 'utf-8');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('migrates a pre-content-root pin once and never suffixes it again', async () => {
    // The shape agentman wrote before content-root addressing: no source name,
    // no addressing marker, and a URL the client used to append /agents/ to.
    await recordInstall('claude-code', 'react-skill', {
      installedAt: '2026-08-01T00:00:00.000Z',
      method: 'symlink',
      sourcePin: {
        sourceType: 'bundle',
        installLayout: 'flat',
        bundleBaseUrl: 'https://content.example.com',
        bundleVersion: '1.0.0',
      },
    });

    await updateInstalled('react-skill', 'system', 'claude-code');

    expect(vi.mocked(downloadBundle).mock.calls[0]![0]).toBe('https://content.example.com/agents');
    // The record must come back marked, or the next update suffixes it again.
    expect(await pinOf()).toMatchObject({
      bundleBaseUrl: 'https://content.example.com/agents',
      bundleAddressing: 'content-root',
    });

    await updateInstalled('react-skill', 'system', 'claude-code');

    expect(vi.mocked(downloadBundle).mock.calls[1]![0]).toBe('https://content.example.com/agents');
    expect(await pinOf()).toMatchObject({ bundleBaseUrl: 'https://content.example.com/agents' });
  });

  it('leaves a pin that already addresses a content root untouched', async () => {
    // What a bare-URL install writes today: no source name either, but the URL
    // is already a content root, so suffixing it would break a working install.
    await recordInstall('claude-code', 'react-skill', {
      installedAt: '2026-08-19T00:00:00.000Z',
      method: 'symlink',
      sourcePin: {
        sourceType: 'bundle',
        installLayout: 'flat',
        bundleBaseUrl: 'https://content.example.com/catalogue',
        bundleAddressing: 'content-root',
        bundleVersion: '1.0.0',
      },
    });

    await updateInstalled('react-skill', 'system', 'claude-code');

    expect(vi.mocked(downloadBundle).mock.calls[0]![0]).toBe('https://content.example.com/catalogue');
  });
});
