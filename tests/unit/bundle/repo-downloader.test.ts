import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseRepoUrl,
  buildArchiveUrl,
  downloadRepoArchive,
} from '../../../src/bundle/repo-downloader.js';
import type { RepoSkillSource } from '../../../src/bundle/skill-source.js';

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
let mockReposDir = '';

vi.mock('../../../src/config/paths.js', () => ({
  getTempDir: () => mockTempDir,
  getRepoCacheDir: (owner: string, repo: string, ref: string) =>
    path.join(mockReposDir, owner, repo, ref),
}));

// ── extract-zip mock ──────────────────────────────────────────────────────────

vi.mock('extract-zip', () => ({ default: mockExtractZip }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<RepoSkillSource> = {}): RepoSkillSource {
  return {
    type: 'repo',
    repoUrl: 'https://github.com/org/my-skills',
    ref: 'main',
    installLayout: 'namespaced',
    ...overrides,
  };
}

// ── parseRepoUrl ──────────────────────────────────────────────────────────────

describe('parseRepoUrl', () => {
  it('parses owner and repo from a standard GitHub URL', () => {
    expect(parseRepoUrl('https://github.com/org/my-repo')).toEqual({
      owner: 'org',
      repo: 'my-repo',
    });
  });

  it('ignores extra path segments', () => {
    expect(parseRepoUrl('https://github.com/org/my-repo/tree/main')).toEqual({
      owner: 'org',
      repo: 'my-repo',
    });
  });

  it('parses a GHES URL', () => {
    expect(parseRepoUrl('https://github.acme-corp.com/org/my-repo')).toEqual({
      owner: 'org',
      repo: 'my-repo',
    });
  });

  it('strips .git suffix from repo name', () => {
    expect(parseRepoUrl('https://github.com/org/my-repo.git')).toEqual({
      owner: 'org',
      repo: 'my-repo',
    });
  });

  it('throws for a URL with only one path segment', () => {
    expect(() => parseRepoUrl('https://github.com/org')).toThrow(
      'Invalid GitHub repository URL',
    );
  });
});

// ── buildArchiveUrl ───────────────────────────────────────────────────────────

describe('buildArchiveUrl', () => {
  it('builds the archive URL for a branch ref', () => {
    expect(buildArchiveUrl('https://github.com/org/my-repo', 'main')).toBe(
      'https://github.com/org/my-repo/archive/main.zip',
    );
  });

  it('builds the archive URL for a tag ref', () => {
    expect(buildArchiveUrl('https://github.com/org/my-repo', 'v1.2.3')).toBe(
      'https://github.com/org/my-repo/archive/v1.2.3.zip',
    );
  });

  it('builds the archive URL for a commit SHA', () => {
    const sha = 'abc123def456';
    expect(buildArchiveUrl('https://github.com/org/my-repo', sha)).toBe(
      `https://github.com/org/my-repo/archive/${sha}.zip`,
    );
  });

  it('builds archive URL for a GHES repo', () => {
    expect(buildArchiveUrl('https://github.acme-corp.com/org/my-repo', 'main')).toBe(
      'https://github.acme-corp.com/org/my-repo/archive/main.zip',
    );
  });
});

// ── downloadRepoArchive ───────────────────────────────────────────────────────

describe('downloadRepoArchive', () => {
  beforeEach(async () => {
    mockTempDir = await mkdir(path.join(os.tmpdir(), `agentman-test-tmp-${Date.now()}`), {
      recursive: true,
    }).then(() => path.join(os.tmpdir(), `agentman-test-tmp-${Date.now() - 1}`));
    mockTempDir = path.join(os.tmpdir(), `agentman-repo-tmp-${Date.now()}`);
    mockReposDir = path.join(os.tmpdir(), `agentman-repos-${Date.now()}`);
    await mkdir(mockTempDir, { recursive: true });
    await mkdir(mockReposDir, { recursive: true });

    mockExtractZip.mockReset();
    trackTelemetryEvent.mockReset();
    trackTelemetryError.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(mockTempDir, { recursive: true, force: true });
    await rm(mockReposDir, { recursive: true, force: true });
  });

  it('returns cached result when cache exists and forceUpdate is false', async () => {
    const cacheDir = path.join(mockReposDir, 'org', 'my-skills', 'main');
    await mkdir(cacheDir, { recursive: true });

    const result = await downloadRepoArchive(makeSource());

    expect(result.isNew).toBe(false);
    expect(result.extractDir).toBe(cacheDir);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('re-downloads when forceUpdate is true even if cache exists', async () => {
    const cacheDir = path.join(mockReposDir, 'org', 'my-skills', 'main');
    await mkdir(cacheDir, { recursive: true });

    // Simulate extractZip creating the inner dir structure
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await mkdir(path.join(dir, 'my-skills-main'), { recursive: true });
    });

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const result = await downloadRepoArchive(makeSource(), { forceUpdate: true });

    expect(result.isNew).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('sends Authorization header when token is provided', async () => {
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await mkdir(path.join(dir, 'my-skills-main'), { recursive: true });
    });

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await downloadRepoArchive(makeSource(), { token: 'ghp_test_token' });

    const [, options] = mockFetch.mock.calls[0];
    expect((options as RequestInit).headers).toMatchObject({
      Authorization: 'token ghp_test_token',
    });
  });

  it('does not send Authorization header when token is absent', async () => {
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await mkdir(path.join(dir, 'my-skills-main'), { recursive: true });
    });

    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await downloadRepoArchive(makeSource());

    const [, options] = mockFetch.mock.calls[0];
    expect((options as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('throws a descriptive error on 404', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow('Repository not found');
  });

  it('throws an auth error on 401', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow('Authentication required');
  });

  it('throws an auth error on 403', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow('Authentication required');
  });

  it('throws a generic error on 500', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow(
      'Failed to download repository archive: 500',
    );
  });

  it('throws when archive has no top-level directory', async () => {
    mockExtractZip.mockImplementation(async () => {
      // Extract to empty dir — no top-level directory
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow(
      'Unexpected archive structure',
    );
  });

  it('fires repo_download_started telemetry', async () => {
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await mkdir(path.join(dir, 'my-skills-main'), { recursive: true });
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await downloadRepoArchive(makeSource());

    expect(trackTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo_download_started' }),
    );
  });

  it('fires repo_download_succeeded telemetry on success', async () => {
    mockExtractZip.mockImplementation(async (_zipPath: string, { dir }: { dir: string }) => {
      await mkdir(path.join(dir, 'my-skills-main'), { recursive: true });
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    await downloadRepoArchive(makeSource());

    expect(trackTelemetryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo_download_succeeded' }),
    );
  });

  it('fires repo_download_failed telemetry on error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    await expect(downloadRepoArchive(makeSource())).rejects.toThrow();

    expect(trackTelemetryError).toHaveBeenCalledWith(
      'repo_download_failed',
      expect.any(Error),
      expect.objectContaining({ owner: 'org', repo: 'my-skills', ref: 'main' }),
    );
  });

  it('uses defaultBranch when ref is not set', async () => {
    const source = makeSource({ ref: undefined, defaultBranch: 'develop' });
    const cacheDir = path.join(mockReposDir, 'org', 'my-skills', 'develop');
    await mkdir(cacheDir, { recursive: true });

    const result = await downloadRepoArchive(source);

    expect(result.extractDir).toBe(cacheDir);
    expect(result.isNew).toBe(false);
  });

  it('falls back to main when neither ref nor defaultBranch is set', async () => {
    const source = makeSource({ ref: undefined, defaultBranch: undefined });
    const cacheDir = path.join(mockReposDir, 'org', 'my-skills', 'main');
    await mkdir(cacheDir, { recursive: true });

    const result = await downloadRepoArchive(source);

    expect(result.extractDir).toBe(cacheDir);
    expect(result.isNew).toBe(false);
  });
});
