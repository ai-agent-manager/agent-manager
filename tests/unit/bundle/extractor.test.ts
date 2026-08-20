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

function versionDir(sourceKey: string, version: string): string {
  return path.join(tmpDir, '.agentman', 'bundles', 'sources', sourceKey, version);
}

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

  it('records the content root inside the version it attests', async () => {
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });

    const marker = await readFile(path.join(versionDir('official', '1.0.0'), '.source.json'), 'utf-8');
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

  // The resolver records a URL straight from a discovery document while the
  // update path records one that has been through a pin, so the two forms reach
  // the marker unequal as written. Comparing them literally makes a single
  // publisher accuse itself of colliding with another.
  it.each([
    ['trailing slash', 'https://a.example.com/agents/', 'https://a.example.com/agents'],
    ['host casing', 'https://A.EXAMPLE.com/agents', 'https://a.example.com/agents'],
    ['default port', 'https://a.example.com:443/agents', 'https://a.example.com/agents'],
    ['query string', 'https://a.example.com/agents?channel=stable', 'https://a.example.com/agents'],
    ['fragment', 'https://a.example.com/agents#section', 'https://a.example.com/agents'],
  ])('treats %s as the same content root, recorded first', async (_label, recorded, compared) => {
    await extractBundle('/tmp/ignored.zip', { sourceKey: 'official', contentRoot: recorded });
    const second = await extractBundle('/tmp/ignored.zip', { sourceKey: 'official', contentRoot: compared });

    expect(second.isNew).toBe(false);
  });

  it('treats an equivalent content root as the same when the canonical form is recorded first', async () => {
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    const second = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://A.EXAMPLE.com:443/agents/?channel=stable',
    });

    expect(second.isNew).toBe(false);
  });

  // Versions sit directly under the source directory, so one named after the
  // marker would be extracted over it. The marker write then fails, and every
  // later provenance read hits a directory — silencing the guard for that
  // source, which is exactly what it exists to prevent.
  it('rejects a manifest version that would clobber the provenance marker', async () => {
    zipContents = manifest('source.json');

    await expect(
      extractBundle('/tmp/ignored.zip', {
        sourceKey: 'official',
        contentRoot: 'https://a.example.com/agents',
      }),
    ).rejects.toThrow(/must not be 'source\.json'/);
  });

  it('does not reuse a version whose provenance cannot be read', async () => {
    const first = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(first.isNew).toBe(true);

    // Absent or unreadable provenance must not be read as "nothing to check",
    // or contents of unknown origin are served as attested.
    await writeFile(path.join(versionDir('official', '1.0.0'), '.source.json'), 'not json', 'utf-8');

    const second = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(second.isNew).toBe(true);
  });

  // Provenance is per version because reuse is per version. A source-level
  // record would let repairing one version vouch for every sibling beside it.
  it('does not vouch for sibling versions when repairing one', async () => {
    zipContents = manifest('1.0.0');
    await extractBundle('/tmp/ignored.zip', { sourceKey: 'official' });
    zipContents = manifest('2.0.0');
    await extractBundle('/tmp/ignored.zip', { sourceKey: 'official' });

    // Both versions are cached with no provenance at all.
    zipContents = manifest('1.0.0');
    const repaired = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(repaired.isNew).toBe(true);

    zipContents = manifest('2.0.0');
    const sibling = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(sibling.isNew).toBe(true);
  });

  it("does not serve one publisher's unattributed version under another's attestation", async () => {
    // Publisher A caches two versions, then its provenance becomes unreadable.
    zipContents = { ...manifest('1.0.0'), 'who.txt': 'publisher-a' };
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    zipContents = { ...manifest('2.0.0'), 'who.txt': 'publisher-a' };
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    for (const version of ['1.0.0', '2.0.0']) {
      await writeFile(path.join(versionDir('official', version), '.source.json'), 'not json', 'utf-8');
    }
    await rm(path.join(tmpDir, '.agentman', 'bundles', 'sources', 'official', 'source.json'), { force: true });

    // Publisher B, same source name, extracts its own 1.0.0…
    zipContents = { ...manifest('1.0.0'), 'who.txt': 'publisher-b' };
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://b.example.com/agents',
    });

    // …which must not make A's 2.0.0 reusable under B's name.
    zipContents = { ...manifest('2.0.0'), 'who.txt': 'publisher-b' };
    const v2 = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://b.example.com/agents',
    });
    expect(v2.isNew).toBe(true);
    expect(await readFile(path.join(v2.bundleDir, 'who.txt'), 'utf-8')).toBe('publisher-b');
  });

  it('still compares equal to a marker written before URLs were canonicalised on read', async () => {
    await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    // The shape an earlier build stored: the URL exactly as the document wrote it.
    await writeFile(
      path.join(versionDir('official', '1.0.0'), '.source.json'),
      JSON.stringify({ contentRoot: 'https://a.example.com/agents/' }),
      'utf-8',
    );

    const again = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(again.isNew).toBe(false);
  });

  it('does not reuse a cache that carries no provenance at all', async () => {
    // Caches written by earlier heads of this change have no marker; they are
    // re-extracted so fresh provenance is recorded, never backfilled.
    await extractBundle('/tmp/ignored.zip', { sourceKey: 'official' });

    const guarded = await extractBundle('/tmp/ignored.zip', {
      sourceKey: 'official',
      contentRoot: 'https://a.example.com/agents',
    });
    expect(guarded.isNew).toBe(true);
  });

  it('rejects a manifest version that would collide with the source-scoped subtree', async () => {
    zipContents = manifest('sources');

    await expect(extractBundle('/tmp/ignored.zip')).rejects.toThrow(
      /must not be 'sources'/,
    );
  });
});
