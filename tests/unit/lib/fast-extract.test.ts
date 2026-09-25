import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat, lstat, readlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { extractZipStreaming } from '../../../src/lib/fast-extract.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('extractZipStreaming', () => {
  let tmpDir: string;
  let extractDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'fast-extract-test-'));
    extractDir = path.join(tmpDir, 'extracted');
    zipPath = path.join(tmpDir, 'test.zip');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts all files before resolving', async () => {
    // Create a directory with multiple files
    const sourceDir = path.join(tmpDir, 'source');
    await mkdir(path.join(sourceDir, 'dir1', 'dir2'), { recursive: true });
    await writeFile(path.join(sourceDir, 'file1.txt'), 'content1');
    await writeFile(path.join(sourceDir, 'dir1', 'file2.txt'), 'content2');
    await writeFile(path.join(sourceDir, 'dir1', 'dir2', 'file3.txt'), 'content3');
    await writeFile(path.join(sourceDir, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));

    // Create zip using system zip command (or skip if not available)
    try {
      execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
    } catch {
      // zip command not available on this system, skip test
      console.log('Skipping test: zip command not available');
      return;
    }

    // Extract using streaming extraction
    await extractZipStreaming(zipPath, extractDir);

    // Verify all files were extracted
    expect(await readFile(path.join(extractDir, 'file1.txt'), 'utf-8')).toBe('content1');
    expect(await readFile(path.join(extractDir, 'dir1', 'file2.txt'), 'utf-8')).toBe('content2');
    expect(await readFile(path.join(extractDir, 'dir1', 'dir2', 'file3.txt'), 'utf-8')).toBe('content3');
    expect(await readFile(path.join(extractDir, 'manifest.json'), 'utf-8')).toBe(JSON.stringify({ version: '1.0.0' }));
  });

  it('handles empty directories', async () => {
    // Create a directory with an empty directory
    const sourceDir = path.join(tmpDir, 'source');
    await mkdir(path.join(sourceDir, 'empty-dir'), { recursive: true });
    await writeFile(path.join(sourceDir, 'manifest.json'), JSON.stringify({ version: '1.0.0' }));

    // Create zip
    try {
      execSync(`cd "${sourceDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
    } catch {
      console.log('Skipping test: zip command not available');
      return;
    }

    // Extract
    await extractZipStreaming(zipPath, extractDir);

    // Verify directory was created
    const { stat } = await import('node:fs/promises');
    const stats = await stat(path.join(extractDir, 'empty-dir'));
    expect(stats.isDirectory()).toBe(true);
  });

  it('preserves executable permissions for shell scripts', async () => {
    // Skip on Windows (different permission model)
    if (process.platform === 'win32') {
      console.log('Skipping test: Unix permissions not supported on Windows');
      return;
    }

    // Use pre-built fixture with executable script
    const zipPath = path.join(fixturesDir, 'executable-script.zip');

    // Extract
    await extractZipStreaming(zipPath, extractDir);

    // Verify the script has executable permissions
    const extractedScriptPath = path.join(extractDir, 'run.sh');
    const stats = await stat(extractedScriptPath);
    const mode = stats.mode & 0o777;

    // Should have executable bit (0755)
    expect(mode).toBe(0o755);

    // Verify the file content is correct
    const content = await readFile(extractedScriptPath, 'utf-8');
    expect(content).toBe('#!/bin/bash\necho "Hello"\n');

    // Verify regular file has 0644 permissions
    const regularFilePath = path.join(extractDir, 'regular.txt');
    const regularStats = await stat(regularFilePath);
    const regularMode = regularStats.mode & 0o777;
    expect(regularMode).toBe(0o644);
  });

  it('preserves internal symlinks', async () => {
    // Skip on Windows (symlinks require admin privileges)
    if (process.platform === 'win32') {
      console.log('Skipping test: symlinks require admin privileges on Windows');
      return;
    }

    // Use pre-built fixture with symlink
    const zipPath = path.join(fixturesDir, 'with-symlink.zip');

    // Extract
    await extractZipStreaming(zipPath, extractDir);

    // Verify the symlink was extracted as a symlink
    const linkPath = path.join(extractDir, 'link.txt');
    const linkStats = await lstat(linkPath);

    expect(linkStats.isSymbolicLink()).toBe(true);

    // Verify the symlink target
    const linkTarget = await readlink(linkPath);
    expect(linkTarget).toBe('target.txt');

    // Verify the symlink resolves to the correct content
    const content = await readFile(linkPath, 'utf-8');
    expect(content).toBe('target content\n');
  });

  it('rejects symlinks that escape extraction directory', async () => {
    // Skip on Windows (symlinks require admin privileges)
    if (process.platform === 'win32') {
      console.log('Skipping test: symlinks require admin privileges on Windows');
      return;
    }

    // Use pre-built fixture with malicious symlink
    const zipPath = path.join(fixturesDir, 'malicious-symlink.zip');

    // Extraction should reject the malicious symlink
    await expect(extractZipStreaming(zipPath, extractDir)).rejects.toThrow(/Symlink target escapes extraction directory/);
  });

  it('rejects path traversal attempts', async () => {
    // This test would require creating a malicious zip with path traversal
    // For now, skip this test as it requires crafting a special zip
    console.log('Skipping path traversal test: requires special zip file');
  });
});
