import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveSource } from '../../../src/bundle/source.js';

describe('resolveSource', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `source-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns url source for https URL', async () => {
    const result = await resolveSource('https://example.com');
    expect(result).toEqual({ type: 'url', baseUrl: 'https://example.com' });
  });

  it('returns url source for http URL', async () => {
    const result = await resolveSource('http://localhost:3000');
    expect(result).toEqual({ type: 'url', baseUrl: 'http://localhost:3000' });
  });

  it('returns url source for https URL with trailing path', async () => {
    const result = await resolveSource('https://cdn.example.com/my-org/');
    expect(result).toEqual({ type: 'url', baseUrl: 'https://cdn.example.com/my-org/' });
  });

  it('returns directory source for an existing directory', async () => {
    const result = await resolveSource(tempDir);
    expect(result).toEqual({ type: 'directory', dirPath: tempDir });
  });

  it('resolves relative paths to absolute', async () => {
    // Use the temp dir relative to cwd — create a subdir inside it
    const subDir = path.join(tempDir, 'sub');
    await mkdir(subDir, { recursive: true });
    const result = await resolveSource(subDir);
    expect(path.isAbsolute(result.type === 'directory' ? result.dirPath : '')).toBe(true);
    expect(result).toEqual({ type: 'directory', dirPath: subDir });
  });

  it('accepts directory without manifest.json', async () => {
    // Directory exists but has no manifest.json — should still resolve
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
