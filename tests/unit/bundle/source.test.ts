import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

const mockDiscovery: DiscoveryDocument = {
  version: '1',
  skills: [{ name: 'test', type: 'http', url: 'https://example.com/bundle' }],
};

vi.mock('../../../src/discovery/index.js', () => ({
  fetchDiscoveryDocument: vi.fn(async () => mockDiscovery),
}));

const configState = { value: { installations: {} } as import('../../../src/bundle/cache.js').AgentmanConfig };

vi.mock('../../../src/bundle/cache.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/bundle/cache.js')>('../../../src/bundle/cache.js');
  return { ...actual, readConfig: vi.fn(async () => configState.value) };
});

const { resolveSource, resolvePersistedSource } = await import('../../../src/bundle/source.js');

describe('resolveSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `source-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns discovery source for https URL', async () => {
    const result = await resolveSource('https://example.com');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('https://example.com');
      expect(result.discovery).toEqual(mockDiscovery);
    }
  });

  it('returns discovery source for http URL', async () => {
    const result = await resolveSource('http://localhost:3000');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('http://localhost:3000');
    }
  });

  it('returns discovery source for https URL with trailing path', async () => {
    const result = await resolveSource('https://cdn.example.com/my-org/');
    expect(result.type).toBe('discovery');
    if (result.type === 'discovery') {
      expect(result.baseUrl).toBe('https://cdn.example.com/my-org/');
    }
  });

  it('returns directory source for an existing directory', async () => {
    const result = await resolveSource(tempDir);
    expect(result).toEqual({ type: 'directory', dirPath: tempDir });
  });

  it('resolves relative paths to absolute', async () => {
    const subDir = path.join(tempDir, 'sub');
    await mkdir(subDir, { recursive: true });
    const result = await resolveSource(subDir);
    expect(path.isAbsolute(result.type === 'directory' ? result.dirPath : '')).toBe(true);
    expect(result).toEqual({ type: 'directory', dirPath: subDir });
  });

  it('accepts directory without manifest.json', async () => {
    const result = await resolveSource(tempDir);
    expect(result).toEqual({ type: 'directory', dirPath: tempDir });
  });

  it('throws for a non-existent path', async () => {
    const badPath = path.join(tempDir, 'does-not-exist');
    await expect(resolveSource(badPath)).rejects.toThrow('Path does not exist');
  });

  it('throws for a path that is a file, not a directory', async () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');
    await expect(resolveSource(filePath)).rejects.toThrow('Path is not a directory');
  });

  it('throws for an invalid URL', async () => {
    await expect(resolveSource('https://')).rejects.toThrow();
  });
});

describe('resolvePersistedSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `persisted-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    configState.value = { installations: {} };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns null when no sources are configured', async () => {
    expect(await resolvePersistedSource()).toBeNull();
  });

  it('resolves the active source first', async () => {
    configState.value = {
      installations: {},
      sources: [{ kind: 'directory', value: tempDir }],
      activeSource: { kind: 'directory', value: tempDir },
    };

    const resolved = await resolvePersistedSource();
    expect(resolved?.source).toEqual({ type: 'directory', dirPath: tempDir });
    expect(resolved?.stored).toEqual({ kind: 'directory', value: tempDir });
  });

  it('skips a source that fails to resolve and tries the next (per-source isolation)', async () => {
    const badPath = path.join(tempDir, 'does-not-exist');
    configState.value = {
      installations: {},
      sources: [
        { kind: 'directory', value: badPath },
        { kind: 'directory', value: tempDir },
      ],
    };

    const resolved = await resolvePersistedSource();
    expect(resolved?.stored).toEqual({ kind: 'directory', value: tempDir });
  });

  it('throws an aggregated error when every source fails', async () => {
    configState.value = {
      installations: {},
      sources: [
        { kind: 'directory', value: path.join(tempDir, 'nope-1') },
        { kind: 'directory', value: path.join(tempDir, 'nope-2') },
      ],
    };

    await expect(resolvePersistedSource()).rejects.toThrow('None of the configured sources');
  });
});
