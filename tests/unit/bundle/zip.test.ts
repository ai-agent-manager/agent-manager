import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';
import { extractZip } from '../../../src/bundle/zip.js';

// ── Zip builder ───────────────────────────────────────────────────────────────

interface ZipEntrySpec {
  name: string;
  data?: Buffer | string;
  /** Full Unix st_mode (type + permission bits); 0 means "not recorded". */
  mode?: number;
  /** Deflate the data instead of storing it. */
  deflate?: boolean;
}

/**
 * Build a real zip archive in memory. Entries are written as made-by Unix so
 * the mode lands in the high 16 bits of the external attributes, exactly as
 * `zip` and GitHub's archive endpoint do.
 */
function buildZip(entries: ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const spec of entries) {
    const name = Buffer.from(spec.name);
    const raw = Buffer.from(spec.data ?? '');
    const body = spec.deflate ? deflateRawSync(raw) : raw;
    const method = spec.deflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((spec.mode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDir, eocd]);
}

const FILE = 0o100000;
const DIR = 0o040000;
const LINK = 0o120000;
const isWindows = process.platform === 'win32';
const ESCAPE_REJECTED = /Refuse to write file outside|Dangerous link path was refused/;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extractZip', () => {
  let tmpDir: string;
  let zipPath: string;
  let outDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentman-zip-'));
    zipPath = path.join(tmpDir, 'archive.zip');
    outDir = path.join(tmpDir, 'out');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function extract(entries: ZipEntrySpec[]): Promise<void> {
    await writeFile(zipPath, buildZip(entries));
    await extractZip(zipPath, outDir);
  }

  it('extracts nested files and directories', async () => {
    await extract([
      { name: 'repo-main/', mode: DIR | 0o755 },
      { name: 'repo-main/README.md', data: '# readme', mode: FILE | 0o644 },
      { name: 'repo-main/skills/a/SKILL.md', data: 'skill a', mode: FILE | 0o644, deflate: true },
    ]);

    expect(await readFile(path.join(outDir, 'repo-main/README.md'), 'utf-8')).toBe('# readme');
    expect(await readFile(path.join(outDir, 'repo-main/skills/a/SKILL.md'), 'utf-8')).toBe('skill a');
  });

  // Regression: extract-zip stalled forever on Node 26 at the first deflated
  // entry whose compressed size exceeds a 64 KiB stream chunk (a font file in
  // anthropics/skills), leaving the CLI spinner running indefinitely. Random
  // bytes barely compress, so these entries stay well past that size.
  it('extracts large deflated entries completely', async () => {
    const entries: ZipEntrySpec[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push({
        name: `repo/fonts/font${i}.ttf`,
        data: randomBytes(i % 4 === 0 ? 512 * 1024 : 160 * 1024),
        mode: FILE | 0o644,
        deflate: true,
      });
      entries.push({ name: `repo/fonts/font${i}-OFL.txt`, data: 'licence text', mode: FILE | 0o644 });
    }
    await extract(entries);

    expect(await readdir(path.join(outDir, 'repo/fonts'))).toHaveLength(40);
    for (const spec of entries) {
      const written = await readFile(path.join(outDir, spec.name));
      expect(written.equals(Buffer.from(spec.data!)), spec.name).toBe(true);
    }
  });

  it('skips __MACOSX resource-fork entries', async () => {
    await extract([
      { name: 'SKILL.md', data: 'x' },
      { name: '__MACOSX/._SKILL.md', data: 'junk' },
    ]);

    expect(await readdir(outDir)).toEqual(['SKILL.md']);
  });

  it.skipIf(isWindows)('applies recorded permissions, defaulting when none are recorded', async () => {
    await extract([
      { name: 'run.sh', data: '#!/bin/sh', mode: FILE | 0o755 },
      { name: 'notes.txt', data: 'n', mode: FILE | 0o600 },
      { name: 'plain.txt', data: 'p' },
    ]);

    const perms = async (name: string) => (await lstat(path.join(outDir, name))).mode & 0o777;
    const umask = process.umask();
    expect(await perms('run.sh')).toBe(0o755 & ~umask);
    expect(await perms('notes.txt')).toBe(0o600 & ~umask);
    expect(await perms('plain.txt')).toBe(0o644 & ~umask);
  });

  it.skipIf(isWindows)('recreates symlink entries as symlinks', async () => {
    await extract([
      { name: 'skill/SKILL.md', data: 'real' },
      { name: 'skill/alias.md', data: 'SKILL.md', mode: LINK | 0o777 },
    ]);

    const link = path.join(outDir, 'skill/alias.md');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe('SKILL.md');
    expect(await readFile(link, 'utf-8')).toBe('real');
  });

  it.skipIf(isWindows)('rejects entries written through a symlink that leaves the target', async () => {
    const outside = path.join(tmpDir, 'outside');
    await mkdir(outside);
    await expect(
      extract([
        { name: 'escape', data: outside, mode: LINK | 0o777 },
        { name: 'escape/pwned.txt', data: 'x' },
      ]),
    ).rejects.toThrow(ESCAPE_REJECTED);
    expect(await readdir(outside)).toEqual([]);
  });

  it.skipIf(isWindows)('creates no directories outside the target before rejecting', async () => {
    const outside = path.join(tmpDir, 'outside');
    await mkdir(outside);
    await expect(
      extract([
        { name: 'escape', data: outside, mode: LINK | 0o777 },
        { name: 'escape/a/b/pwned.txt', data: 'x' },
      ]),
    ).rejects.toThrow(ESCAPE_REJECTED);
    expect(await readdir(outside)).toEqual([]);
  });

  it.skipIf(isWindows)('rejects nested directory entries under an escaping symlink', async () => {
    const outside = path.join(tmpDir, 'outside');
    await mkdir(outside);
    await expect(
      extract([
        { name: 'escape', data: outside, mode: LINK | 0o777 },
        { name: 'escape/a/b/', mode: DIR | 0o755 },
      ]),
    ).rejects.toThrow(ESCAPE_REJECTED);
    expect(await readdir(outside)).toEqual([]);
  });

  it.skipIf(isWindows)('never writes a file entry through an earlier symlink of the same name', async () => {
    const victim = path.join(tmpDir, 'victim.txt');
    await writeFile(victim, 'original');

    await expect(
      extract([
        { name: 'link', data: victim, mode: LINK | 0o777 },
        { name: 'link', data: 'payload', mode: FILE | 0o644 },
      ]),
    ).rejects.toThrow(ESCAPE_REJECTED);
    expect(await readFile(victim, 'utf-8')).toBe('original');
  });

  it.skipIf(isWindows)('rejects a symlink whose target leaves the extract directory', async () => {
    await expect(extract([{ name: 'escape', data: '/etc/passwd', mode: LINK | 0o777 }])).rejects.toThrow(
      ESCAPE_REJECTED,
    );
    await expect(lstat(path.join(outDir, 'escape'))).rejects.toThrow();
  });

  it.skipIf(isWindows)('keeps symlinks that point elsewhere inside the target', async () => {
    await extract([
      { name: 'skills/a/SKILL.md', data: 'a' },
      { name: 'skills/b/shared.md', data: '../a/SKILL.md', mode: LINK | 0o777 },
    ]);

    expect(await readFile(path.join(outDir, 'skills/b/shared.md'), 'utf-8')).toBe('a');
  });

  it('keeps the last copy when an entry name is repeated', async () => {
    await extract([
      { name: 'SKILL.md', data: 'first' },
      { name: 'SKILL.md', data: 'second' },
    ]);

    expect(await readFile(path.join(outDir, 'SKILL.md'), 'utf-8')).toBe('second');
  });

  it('rejects path-traversal entry names', async () => {
    await expect(extract([{ name: '../evil.txt', data: 'x' }])).rejects.toThrow();
    await expect(lstat(path.join(tmpDir, 'evil.txt'))).rejects.toThrow();
  });

  it('rejects a corrupt archive instead of hanging', async () => {
    await writeFile(zipPath, Buffer.from('this is not a zip file'));
    await expect(extractZip(zipPath, outDir)).rejects.toThrow();
  });

  it('rejects a relative target directory', async () => {
    await writeFile(zipPath, buildZip([{ name: 'a.txt', data: 'a' }]));
    await expect(extractZip(zipPath, 'relative/out')).rejects.toThrow(/absolute/);
  });
});
