import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {
  ARTEFACT_META_FILE,
  assertZipWithinLimits,
  buildArtefactHashUrl,
  checkArtefactUpdate,
  downloadArtefact,
  fetchArtefactHash,
  MAX_DOWNLOAD_BYTES,
  MAX_EXTRACT_BYTES,
  MAX_EXTRACT_ENTRIES,
  parseArtefactUrl,
  removeEscapingSymlinks,
} from '../../../src/bundle/artefact-downloader.js';
import type { ArtefactSkillSource, SkillSourcePin } from '../../../src/bundle/skill-source.js';

// ── Hoisted mocks (must be before vi.mock calls) ──────────────────────────────

const { trackTelemetryEvent, trackTelemetryError, mockExtractZip } = vi.hoisted(() => ({
  trackTelemetryEvent: vi.fn(),
  trackTelemetryError: vi.fn(),
  mockExtractZip: vi.fn(),
}));

vi.mock('../../../src/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/telemetry.js')>(
    '../../../src/telemetry.js',
  );
  return { ...actual, trackTelemetryEvent, trackTelemetryError };
});

// ── Path mocks ────────────────────────────────────────────────────────────────

let mockTempDir = '';
let mockArtefactsDir = '';

vi.mock('../../../src/config/paths.js', () => ({
  getTempDir: () => mockTempDir,
  getArtefactCacheDir: (name: string, version: string) =>
    path.join(mockArtefactsDir, name, version),
}));

// ── extract-zip mock ──────────────────────────────────────────────────────────

vi.mock('extract-zip', () => ({ default: mockExtractZip }));

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal structurally-valid zip with one stored entry.
 * declaredUncompressedSize is written into the central directory only —
 * the actual file data is empty, mimicking a zip bomb's forged header.
 */
function makeZipBuffer(declaredUncompressedSize: number, entryCount = 1): Buffer {
  const parts: Buffer[] = [];
  const localOffsets: number[] = [];
  let offset = 0;

  const cdEntries: Buffer[] = [];

  for (let i = 0; i < entryCount; i++) {
    const fileName = Buffer.from(`file${i}.txt`);

    const local = Buffer.alloc(30 + fileName.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    fileName.copy(local, 30);

    localOffsets.push(offset);
    parts.push(local);
    offset += local.length;

    const cd = Buffer.alloc(46 + fileName.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(0, 20);
    cd.writeUInt32LE(declaredUncompressedSize >>> 0, 24);
    cd.writeUInt16LE(fileName.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(localOffsets[i], 42);
    fileName.copy(cd, 46);
    cdEntries.push(cd);
  }

  const cdBuf = Buffer.concat(cdEntries);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, cdBuf, eocd]);
}

// A minimal valid zip (1 stored 0-byte entry) — real enough for yauzl to parse
const ZIP_BYTES = new Uint8Array(makeZipBuffer(0, 1));
const ZIP_SHA256 = createHash('sha256').update(ZIP_BYTES).digest('hex');

function makeSource(overrides: Partial<ArtefactSkillSource> = {}): ArtefactSkillSource {
  return {
    type: 'artefact',
    artefactUrl: 'https://cdn.example.com/skills/my-skill-1.2.0.zip',
    installLayout: 'namespaced',
    ...overrides,
  };
}

function okZipResponse(): Response {
  return {
    ok: true,
    arrayBuffer: async () => ZIP_BYTES.buffer.slice(0),
  } as unknown as Response;
}

function sidecarResponse(hash: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => `${hash}  my-skill-1.2.0.zip\n`,
  } as unknown as Response;
}

function notFoundResponse(): Response {
  return { ok: false, status: 404, statusText: 'Not Found' } as Response;
}

/** Mock fetch: zip URL returns the fake zip, sidecar URL returns the given response. */
function mockFetchFor(zipResponse: Response, hashResponse: Response): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    return url.endsWith('.sha256') ? hashResponse : zipResponse;
  });
}

// ── parseArtefactUrl ──────────────────────────────────────────────────────────

describe('parseArtefactUrl', () => {
  it('derives name and version from a versioned filename', () => {
    expect(parseArtefactUrl('https://cdn.example.com/skills/my-skill-1.2.0.zip')).toEqual({
      name: 'my-skill',
      version: '1.2.0',
    });
  });

  it('strips a leading v from the filename version', () => {
    expect(parseArtefactUrl('https://cdn.example.com/my-skill-v2.0.1.zip')).toEqual({
      name: 'my-skill',
      version: '2.0.1',
    });
  });

  it('handles prerelease suffixes in the filename version', () => {
    expect(parseArtefactUrl('https://cdn.example.com/my-skill-1.0.0-beta.1.zip')).toEqual({
      name: 'my-skill',
      version: '1.0.0-beta.1',
    });
  });

  it('derives the version from the parent path segment', () => {
    expect(
      parseArtefactUrl('https://cdn.example.com/skills/my-skill/1.2.0/my-skill.zip'),
    ).toEqual({ name: 'my-skill', version: '1.2.0' });
  });

  it('returns null version when none is derivable', () => {
    expect(parseArtefactUrl('https://cdn.example.com/skills/my-skill.zip')).toEqual({
      name: 'my-skill',
      version: null,
    });
  });

  it('ignores query strings', () => {
    expect(
      parseArtefactUrl('https://cdn.example.com/my-skill-1.2.0.zip?token=abc'),
    ).toEqual({ name: 'my-skill', version: '1.2.0' });
  });

  it('sanitises unsafe characters in the name', () => {
    const { name } = parseArtefactUrl('https://cdn.example.com/my%20skill.zip');
    expect(name).not.toMatch(/[^a-zA-Z0-9._-]/);
  });
});

// ── buildArtefactHashUrl ──────────────────────────────────────────────────────

describe('buildArtefactHashUrl', () => {
  it('appends .sha256 to the artefact URL', () => {
    expect(buildArtefactHashUrl('https://cdn.example.com/my-skill-1.2.0.zip')).toBe(
      'https://cdn.example.com/my-skill-1.2.0.zip.sha256',
    );
  });

  it('strips query string and fragment before appending .sha256', () => {
    expect(buildArtefactHashUrl('https://cdn.example.com/my-skill.zip?token=abc#v1')).toBe(
      'https://cdn.example.com/my-skill.zip.sha256',
    );
  });
});

// ── fetchArtefactHash ─────────────────────────────────────────────────────────

describe('fetchArtefactHash', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a sha256sum-format sidecar', async () => {
    vi.mocked(fetch).mockResolvedValue(sidecarResponse(ZIP_SHA256));
    await expect(fetchArtefactHash('https://cdn.example.com/x.zip')).resolves.toBe(ZIP_SHA256);
  });

  it('returns null on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(notFoundResponse());
    await expect(fetchArtefactHash('https://cdn.example.com/x.zip')).resolves.toBeNull();
  });

  it('returns null on 403', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as Response);
    await expect(fetchArtefactHash('https://cdn.example.com/x.zip')).resolves.toBeNull();
  });

  it('throws on 500', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);
    await expect(fetchArtefactHash('https://cdn.example.com/x.zip')).rejects.toThrow(
      'Failed to fetch hash sidecar',
    );
  });

  it('throws on malformed sidecar content', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'not-a-hash',
    } as unknown as Response);
    await expect(fetchArtefactHash('https://cdn.example.com/x.zip')).rejects.toThrow(
      'Invalid hash sidecar content',
    );
  });
});

// ── downloadArtefact ──────────────────────────────────────────────────────────

describe('downloadArtefact', () => {
  beforeEach(async () => {
    mockTempDir = path.join(os.tmpdir(), `agentman-artefact-tmp-${Date.now()}`);
    mockArtefactsDir = path.join(os.tmpdir(), `agentman-artefacts-${Date.now()}`);
    await mkdir(mockTempDir, { recursive: true });
    await mkdir(mockArtefactsDir, { recursive: true });

    mockExtractZip.mockReset();
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await writeFile(path.join(dir, 'SKILL.md'), '# skill');
    });
    trackTelemetryEvent.mockReset();
    trackTelemetryError.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(mockTempDir, { recursive: true, force: true });
    await rm(mockArtefactsDir, { recursive: true, force: true });
  });

  it('downloads, verifies against the sidecar, and caches the artefact', async () => {
    mockFetchFor(okZipResponse(), sidecarResponse(ZIP_SHA256));

    const result = await downloadArtefact(makeSource());

    expect(result.isNew).toBe(true);
    expect(result.name).toBe('my-skill');
    expect(result.version).toBe('1.2.0');
    expect(result.sha256).toBe(ZIP_SHA256);
    expect(result.extractDir).toBe(path.join(mockArtefactsDir, 'my-skill', '1.2.0'));

    const meta = JSON.parse(
      await readFile(path.join(result.extractDir, ARTEFACT_META_FILE), 'utf-8'),
    );
    expect(meta.version).toBe('1.2.0');
    expect(meta.sha256).toBe(ZIP_SHA256);
    expect(meta.artefactUrl).toBe('https://cdn.example.com/skills/my-skill-1.2.0.zip');
  });

  it('returns the cached artefact without fetching when the version is cached', async () => {
    const cacheDir = path.join(mockArtefactsDir, 'my-skill', '1.2.0');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, ARTEFACT_META_FILE),
      JSON.stringify({
        artefactUrl: 'https://cdn.example.com/skills/my-skill-1.2.0.zip',
        version: '1.2.0',
        sha256: ZIP_SHA256,
        downloadedAt: 'x',
      }),
    );

    const result = await downloadArtefact(makeSource());

    expect(result.isNew).toBe(false);
    expect(result.version).toBe('1.2.0');
    expect(result.sha256).toBe(ZIP_SHA256);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-downloads when the cache entry came from a different URL (no cross-source reuse)', async () => {
    // Same <name>/<version> cache key, but downloaded from another host
    const cacheDir = path.join(mockArtefactsDir, 'my-skill', '1.2.0');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, ARTEFACT_META_FILE),
      JSON.stringify({
        artefactUrl: 'https://other-cdn.example.com/skills/my-skill-1.2.0.zip',
        version: '1.2.0',
        sha256: 'f'.repeat(64),
        downloadedAt: 'x',
      }),
    );

    mockFetchFor(okZipResponse(), notFoundResponse());

    const result = await downloadArtefact(makeSource());

    expect(result.isNew).toBe(true);
    expect(result.sha256).toBe(ZIP_SHA256);
    expect(fetch).toHaveBeenCalled();
  });

  it('re-downloads when forceUpdate is true even if cached', async () => {
    const cacheDir = path.join(mockArtefactsDir, 'my-skill', '1.2.0');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, ARTEFACT_META_FILE),
      JSON.stringify({
        artefactUrl: 'https://cdn.example.com/skills/my-skill-1.2.0.zip',
        version: '1.2.0',
        sha256: ZIP_SHA256,
        downloadedAt: 'x',
      }),
    );

    mockFetchFor(okZipResponse(), sidecarResponse(ZIP_SHA256));

    const result = await downloadArtefact(makeSource(), { forceUpdate: true });

    expect(result.isNew).toBe(true);
    expect(fetch).toHaveBeenCalled();
  });

  it('re-downloads when the cached hash does not match an explicitly pinned sha256', async () => {
    const cacheDir = path.join(mockArtefactsDir, 'my-skill', '1.2.0');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, ARTEFACT_META_FILE),
      JSON.stringify({
        artefactUrl: 'https://cdn.example.com/skills/my-skill-1.2.0.zip',
        version: '1.2.0',
        sha256: 'f'.repeat(64),
        downloadedAt: 'x',
      }),
    );

    mockFetchFor(okZipResponse(), notFoundResponse());

    const result = await downloadArtefact(makeSource({ sha256: ZIP_SHA256 }));

    expect(result.isNew).toBe(true);
    expect(result.sha256).toBe(ZIP_SHA256);
  });

  it('verifies against an explicitly pinned sha256 instead of the sidecar', async () => {
    mockFetchFor(okZipResponse(), sidecarResponse('f'.repeat(64)));

    // Sidecar hash is wrong, but the explicit pin matches — must succeed
    const result = await downloadArtefact(makeSource({ sha256: ZIP_SHA256 }));
    expect(result.isNew).toBe(true);

    // Sidecar URL must not even be fetched when an explicit pin exists
    const sidecarCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => String(input).endsWith('.sha256'));
    expect(sidecarCalls).toHaveLength(0);
  });

  it('throws IntegrityError and reports failure when the hash does not match', async () => {
    mockFetchFor(okZipResponse(), sidecarResponse('f'.repeat(64)));

    await expect(downloadArtefact(makeSource())).rejects.toThrow('integrity check failed');
    expect(trackTelemetryError).toHaveBeenCalledWith(
      'artefact_download_failed',
      expect.any(Error),
      expect.objectContaining({ name: 'my-skill' }),
    );
  });

  it('proceeds with a warning when no sidecar exists and no sha256 is pinned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchFor(okZipResponse(), notFoundResponse());

    const result = await downloadArtefact(makeSource());

    expect(result.isNew).toBe(true);
    expect(result.sha256).toBe(ZIP_SHA256);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Skipping integrity check'));
    warn.mockRestore();
  });

  it('resolves the version from an embedded manifest.json when the URL has none', async () => {
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await writeFile(path.join(dir, 'SKILL.md'), '# skill');
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version: '3.4.5' }));
    });
    mockFetchFor(okZipResponse(), notFoundResponse());

    const result = await downloadArtefact(
      makeSource({ artefactUrl: 'https://cdn.example.com/my-skill.zip' }),
    );

    expect(result.version).toBe('3.4.5');
    expect(result.extractDir).toBe(path.join(mockArtefactsDir, 'my-skill', '3.4.5'));
  });

  it('falls back to a content-hash version when nothing else is available', async () => {
    mockFetchFor(okZipResponse(), notFoundResponse());

    const result = await downloadArtefact(
      makeSource({ artefactUrl: 'https://cdn.example.com/my-skill.zip' }),
    );

    expect(result.version).toBe(`sha-${ZIP_SHA256.slice(0, 12)}`);
  });

  it('throws a descriptive error on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(notFoundResponse());

    await expect(downloadArtefact(makeSource())).rejects.toThrow('Artefact not found');
  });

  it('throws an access error on 403', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' } as Response);

    await expect(downloadArtefact(makeSource())).rejects.toThrow('Access denied');
  });

  it('throws a generic error on 500', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(downloadArtefact(makeSource())).rejects.toThrow(
      'Failed to download artefact: 500',
    );
  });

  it('fires started and succeeded telemetry on success', async () => {
    mockFetchFor(okZipResponse(), sidecarResponse(ZIP_SHA256));

    await downloadArtefact(makeSource());

    expect(trackTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'artefact_download_started' }),
    );
    expect(trackTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'artefact_download_succeeded' }),
    );
  });
});

// ── checkArtefactUpdate ───────────────────────────────────────────────────────

describe('checkArtefactUpdate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makePin(overrides: Partial<SkillSourcePin> = {}): SkillSourcePin {
    return {
      sourceType: 'artefact',
      installLayout: 'namespaced',
      artefactUrl: 'https://cdn.example.com/my-skill-1.2.0.zip',
      sha256: ZIP_SHA256,
      artefactVersion: '1.2.0',
      ...overrides,
    };
  }

  it('reports an update when the remote hash differs from the pin', async () => {
    vi.mocked(fetch).mockResolvedValue(sidecarResponse('f'.repeat(64)));

    const result = await checkArtefactUpdate(makePin());

    expect(result.updateAvailable).toBe(true);
    expect(result.pinnedSha256).toBe(ZIP_SHA256);
    expect(result.remoteSha256).toBe('f'.repeat(64));
  });

  it('reports no update when the remote hash matches the pin', async () => {
    vi.mocked(fetch).mockResolvedValue(sidecarResponse(ZIP_SHA256));

    const result = await checkArtefactUpdate(makePin());

    expect(result.updateAvailable).toBe(false);
  });

  it('reports no update when the remote sidecar is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue(notFoundResponse());

    const result = await checkArtefactUpdate(makePin());

    expect(result.updateAvailable).toBe(false);
    expect(result.remoteSha256).toBeNull();
  });

  it('reports no update when the pin has no sha256 to compare', async () => {
    vi.mocked(fetch).mockResolvedValue(sidecarResponse('f'.repeat(64)));

    const result = await checkArtefactUpdate(makePin({ sha256: undefined }));

    expect(result.updateAvailable).toBe(false);
  });

  it('never mutates the pin — version pinning stays stable across checks', async () => {
    vi.mocked(fetch).mockResolvedValue(sidecarResponse('f'.repeat(64)));

    const pin = makePin();
    const snapshot = structuredClone(pin);

    await checkArtefactUpdate(pin);

    expect(pin).toEqual(snapshot);
  });

  it('throws for a non-artefact pin', async () => {
    const pin: SkillSourcePin = {
      sourceType: 'repo',
      installLayout: 'namespaced',
      repoUrl: 'https://github.com/org/repo',
    };

    await expect(checkArtefactUpdate(pin)).rejects.toThrow('artefact source pin');
  });
});

describe('enforceArtefactUrl', () => {
  it('rejects plain http on non-loopback hosts', async () => {
    const source: ArtefactSkillSource = {
      type: 'artefact',
      artefactUrl: 'http://cdn.example.com/my-skill-1.0.0.zip',
      installLayout: 'namespaced',
    };
    await expect(downloadArtefact(source)).rejects.toThrow('Artefact URLs must use https');
  });

  it('allows http on localhost', async () => {
    const source: ArtefactSkillSource = {
      type: 'artefact',
      artefactUrl: 'http://localhost:8080/my-skill-1.0.0.zip',
      installLayout: 'namespaced',
    };
    // Will fail on fetch (no server), but should NOT throw the https error
    await expect(downloadArtefact(source)).rejects.not.toThrow('Artefact URLs must use https');
  });

  it('allows https on any host', async () => {
    const source: ArtefactSkillSource = {
      type: 'artefact',
      artefactUrl: 'https://cdn.example.com/my-skill-1.0.0.zip',
      installLayout: 'namespaced',
    };
    // Will fail on fetch (mocked/no server), but should NOT throw the https error
    await expect(downloadArtefact(source)).rejects.not.toThrow('Artefact URLs must use https');
  });
});

describe('removeEscapingSymlinks', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `symlink-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('removes symlinks pointing outside the root directory', async () => {
    const skillDir = path.join(tempDir, 'my-skill');
    await mkdir(skillDir);
    await writeFile(path.join(skillDir, 'SKILL.md'), '# legit');
    await symlink('/etc/passwd', path.join(skillDir, 'leak'));

    const removed = await removeEscapingSymlinks(tempDir);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('leak');
  });

  it('keeps symlinks pointing within the root directory', async () => {
    const target = path.join(tempDir, 'real-file.md');
    await writeFile(target, '# real');
    await symlink(target, path.join(tempDir, 'internal-link'));

    const removed = await removeEscapingSymlinks(tempDir);
    expect(removed).toHaveLength(0);
  });

  it('removes symlinks with dangling targets', async () => {
    await symlink('/nonexistent/path/nowhere', path.join(tempDir, 'dangling'));

    const removed = await removeEscapingSymlinks(tempDir);
    expect(removed).toHaveLength(1);
  });

  it('recursively checks nested directories', async () => {
    const nested = path.join(tempDir, 'a', 'b');
    await mkdir(nested, { recursive: true });
    await symlink('/etc/hosts', path.join(nested, 'escape'));

    const removed = await removeEscapingSymlinks(tempDir);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain(path.join('a', 'b', 'escape'));
  });
});

describe('download size limits', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when Content-Length header exceeds MAX_DOWNLOAD_BYTES', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h === 'content-length' ? String(MAX_DOWNLOAD_BYTES + 1) : null) },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);

    await expect(downloadArtefact(makeSource())).rejects.toThrow('Content-Length');
  });

  it('rejects when actual buffer size exceeds MAX_DOWNLOAD_BYTES', async () => {
    const oversized = new ArrayBuffer(MAX_DOWNLOAD_BYTES + 1);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => oversized,
    } as unknown as Response);

    await expect(downloadArtefact(makeSource())).rejects.toThrow('actual size');
  });
});

// ── assertZipWithinLimits ─────────────────────────────────────────────────────

describe('assertZipWithinLimits', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `zip-limits-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects before extraction when central directory declares uncompressed size above limit', async () => {
    const zipPath = path.join(tempDir, 'bomb.zip');
    await writeFile(zipPath, makeZipBuffer(MAX_EXTRACT_BYTES + 1));

    const tempExtractDir = path.join(tempDir, 'extracted');

    await expect(assertZipWithinLimits(zipPath)).rejects.toThrow('zip bomb');

    // Nothing was written to disk — extraction never started
    await expect(import('node:fs/promises').then(fs => fs.access(tempExtractDir))).rejects.toThrow();
  });

  it('rejects when central directory entry count exceeds limit', async () => {
    const zipPath = path.join(tempDir, 'many-entries.zip');
    await writeFile(zipPath, makeZipBuffer(0, MAX_EXTRACT_ENTRIES + 1));

    await expect(assertZipWithinLimits(zipPath)).rejects.toThrow('zip bomb');
  });

  it('accepts a normal zip within limits', async () => {
    const zipPath = path.join(tempDir, 'normal.zip');
    // 0-byte stored entry — compressedSize == uncompressedSize == 0, well within limits
    await writeFile(zipPath, makeZipBuffer(0, 1));

    await expect(assertZipWithinLimits(zipPath)).resolves.toBeUndefined();
  });
});
