import { createWriteStream } from 'node:fs';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const DEFAULT_DIR_MODE = 0o755;
const DEFAULT_FILE_MODE = 0o644;

/**
 * Extract a zip archive into `dir`.
 *
 * Replaces `extract-zip`, which hangs part-way through archives on newer Node
 * releases (seen on Node 26). Behaviour is kept identical so cached content
 * and the downstream symlink/size checks see the same tree as before:
 * - `__MACOSX/` resource-fork entries are skipped;
 * - an entry whose real parent directory resolves outside `dir` (for example
 *   through a symlink extracted earlier) is rejected;
 * - Unix permission bits are applied, defaulting to 0o755 / 0o644 when the
 *   archive records none;
 * - symlink entries are recreated as symlinks — callers that must not trust
 *   them run removeEscapingSymlinks() afterwards.
 */
export async function extractZip(zipPath: string, dir: string): Promise<void> {
  if (!path.isAbsolute(dir)) {
    throw new Error('Target directory is expected to be absolute');
  }
  await mkdir(dir, { recursive: true });
  const root = await realpath(dir);

  const zipfile = await openZip(zipPath);
  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('error', reject);
      // With lazyEntries, 'end' only fires after readEntry() finds no further
      // entries — i.e. after the last entry below has been fully written.
      zipfile.on('end', () => resolve());
      zipfile.on('entry', (entry: yauzl.Entry) => {
        extractEntry(zipfile, entry, root).then(() => zipfile.readEntry(), reject);
      });
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });
}

function openReadStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

async function extractEntry(zipfile: yauzl.ZipFile, entry: yauzl.Entry, root: string): Promise<void> {
  if (entry.fileName.startsWith('__MACOSX/')) return;

  const dest = path.join(root, entry.fileName);
  const parentDir = path.dirname(dest);
  await mkdir(parentDir, { recursive: true });
  const relativeParent = path.relative(root, await realpath(parentDir));
  if (relativeParent.split(path.sep).includes('..')) {
    throw new Error(`Out of bound path found while processing file ${entry.fileName}`);
  }

  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const isSymlink = (mode & S_IFMT) === S_IFLNK;
  const isDir =
    (mode & S_IFMT) === S_IFDIR ||
    entry.fileName.endsWith('/') ||
    // Windows archivers mark directories with the DOS attribute alone.
    (entry.versionMadeBy >> 8 === 0 && entry.externalFileAttributes === 16);
  const permissions = (mode === 0 ? (isDir ? DEFAULT_DIR_MODE : DEFAULT_FILE_MODE) : mode) & 0o777;

  if (isDir) {
    await mkdir(dest, { recursive: true, mode: permissions });
    return;
  }

  const stream = await openReadStream(zipfile, entry);
  if (isSymlink) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    await symlink(Buffer.concat(chunks).toString('utf-8'), dest);
    return;
  }
  await pipeline(stream, createWriteStream(dest, { mode: permissions }));
}
