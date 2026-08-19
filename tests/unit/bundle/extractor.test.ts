import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

vi.mock('../../../src/lib/platform.js', () => ({
  getHomeDir: () => tmpDir,
  isWindows: () => false,
}));

// extract-zip is replaced by a copy of a prepared directory, so these tests
// exercise the caching and provenance logic rather than zip decoding.
let zipContents: Record<string, string> = {};
vi.mock('extract-zip', () => ({
  default: async (_zipPath: string, opts: { dir: string }) => {
    await mkdir(opts.dir, { recursive: true });
    for (const [name, body] of Object.entries(zipContents)) {
      await writeFile(path.join(opts.dir, name), body, 'utf-8');
    }
  },
}));

const { extractBundle } = await import('../../../src/bundle/extractor.js');

function manifest(version: string): Record<string, string> {
  return {
    'manifest.json': JSON.stringify({ version, published: '2026-01-01T00:00:00Z', agents: [] }),
  };
}

describe('extractBundle — source-scoped cache', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-extractor-'));
    zipContents = manifest('1.0.0');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('records the content root a source was cached from', async () => {
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });

    const marker = await readFile(
      path.join(tmpDir, '.agentman', 'bundles', 'sources', 'official', 'source.json'),
      'utf-8',
    );
    expect(JSON.parse(marker).contentRoot).toBe('https://a.example.com/agents');
  });

  it('reuses the cache for the same source name and content root', async () => {
    const first = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    const second = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.bundleDir).toBe(first.bundleDir);
  });

  // Source names are only unique within one discovery document, so two documents
  // can each declare "official". Without this guard the second one is silently
  // served the first publisher's bundle under its own pin.
  it('refuses to serve one publisher cache to another using the same source name', async () => {
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });

    await expect(
      extractBundle('/tmp/ignored.zip', {
        sourceKey: 'official',
        contentRoot: 'https://b.example.com/agents',
      }),
    ).rejects.toThrow(/already cached from a different content root/);
  });

  it('rejects a manifest version that would collide with the source-scoped subtree', async () => {
    zipContents = manifest('sources');

    await expect(extractBundle('/tmp/ignored.zip')).rejects.toThrow(
      /must not be 'sources'/,
    );
  });
});
