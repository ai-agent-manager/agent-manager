/**
 * Fast ZIP extraction using yauzl streaming reader.
 * Used on Mac/Linux. Windows uses PowerShell extraction.
 */

import { mkdir, chmod, symlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import yauzl from 'yauzl';

// Unix file type constants from stat.h
const S_IFMT = 0o170000; // File type mask
const S_IFLNK = 0o120000; // Symbolic link

/**
 * Extract the Unix file mode from ZIP external file attributes.
 * Returns null if the ZIP was not created on a Unix system.
 */
function getUnixMode(entry: yauzl.Entry): number | null {
  // The externalFileAttributes is a 32-bit value.
  // For Unix, the high 16 bits contain the file mode.
  // The versionMadeBy field tells us the creator system.
  // Upper byte of versionMadeBy is the system type (0 = MS-DOS, 3 = Unix)
  const systemType = (entry.versionMadeBy >> 8) & 0xff;

  // Only trust Unix permissions if the ZIP was created on Unix
  if (systemType !== 3) {
    return null;
  }

  // Extract the Unix file mode from the high 16 bits
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return mode;
}

/**
 * Check if the entry is a symbolic link based on Unix file mode.
 */
function isSymlink(entry: yauzl.Entry): boolean {
  const mode = getUnixMode(entry);
  if (mode === null) {
    return false;
  }

  // Check if the file type is symlink
  return (mode & S_IFMT) === S_IFLNK;
}

/**
 * Get the permission bits from Unix file mode.
 * Returns a safe default (0644) if not available.
 */
function getPermissions(entry: yauzl.Entry): number {
  const mode = getUnixMode(entry);
  if (mode === null) {
    // Default permissions for regular files
    return 0o644;
  }

  // Extract permission bits (rwxrwxrwx)
  return mode & 0o777;
}

/**
 * Extract a ZIP file using streaming (fast on Mac/Linux).
 */
export async function extractZipStreaming(zipPath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let hasRejected = false;
    let entryCount = 0;
    let processedCount = 0;

    const safeReject = (err: Error) => {
      if (!hasRejected) {
        hasRejected = true;
        reject(err);
      }
    };

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        safeReject(err);
        return;
      }
      if (!zipfile) {
        safeReject(new Error('Failed to open ZIP file'));
        return;
      }

      zipfile.readEntry();

      zipfile.on('entry', async (entry: yauzl.Entry) => {
        entryCount++;
        const entryPath = path.join(targetDir, entry.fileName);

        // Security check: prevent path traversal
        const resolvedEntry = path.resolve(targetDir, entryPath);
        const normalizedTarget = path.resolve(targetDir);
        if (!resolvedEntry.startsWith(normalizedTarget + path.sep) && resolvedEntry !== normalizedTarget) {
          safeReject(new Error(`Path traversal attempt detected: ${entry.fileName}`));
          return;
        }

        if (entry.fileName.endsWith('/')) {
          // Directory entry
          try {
            await mkdir(entryPath, { recursive: true });
            processedCount++;
            zipfile.readEntry();
          } catch (mkdirErr) {
            safeReject(mkdirErr as Error);
          }
        } else if (isSymlink(entry)) {
          // Symlink entry - read target from file data
          try {
            // Ensure parent directory exists
            await mkdir(path.dirname(entryPath), { recursive: true });

            // Read the symlink target from the ZIP entry
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr) {
                safeReject(streamErr);
                return;
              }
              if (!readStream) {
                safeReject(new Error('Failed to create read stream for symlink'));
                return;
              }

              const chunks: Buffer[] = [];
              readStream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
              });

              readStream.on('error', (readErr) => {
                safeReject(readErr);
              });

              readStream.on('end', async () => {
                try {
                  // The symlink target is stored in the file data
                  const target = Buffer.concat(chunks).toString('utf8');

                  // Security check: ensure symlink target doesn't escape the extraction directory
                  const resolvedTarget = path.resolve(path.dirname(entryPath), target);
                  const normalizedTarget = path.resolve(targetDir);
                  if (!resolvedTarget.startsWith(normalizedTarget + path.sep) && resolvedTarget !== normalizedTarget) {
                    safeReject(new Error(`Symlink target escapes extraction directory: ${entry.fileName} -> ${target}`));
                    return;
                  }

                  // Create the symlink
                  await symlink(target, entryPath);
                  processedCount++;
                  zipfile.readEntry();
                } catch (symlinkErr) {
                  safeReject(symlinkErr as Error);
                }
              });
            });
          } catch (extractErr) {
            safeReject(extractErr as Error);
          }
        } else {
          // Regular file entry
          try {
            // Ensure parent directory exists
            await mkdir(path.dirname(entryPath), { recursive: true });

            // Extract file using streaming
            zipfile.openReadStream(entry, (streamErr, readStream) => {
              if (streamErr) {
                safeReject(streamErr);
                return;
              }
              if (!readStream) {
                safeReject(new Error('Failed to create read stream'));
                return;
              }

              const writeStream = createWriteStream(entryPath);

              writeStream.on('error', (writeErr) => {
                safeReject(writeErr);
              });

              readStream.on('error', (readErr) => {
                safeReject(readErr);
              });

              writeStream.on('finish', async () => {
                try {
                  // Preserve Unix permissions
                  const permissions = getPermissions(entry);
                  await chmod(entryPath, permissions);

                  processedCount++;
                  zipfile.readEntry();
                } catch (chmodErr) {
                  safeReject(chmodErr as Error);
                }
              });

              readStream.pipe(writeStream);
            });
          } catch (extractErr) {
            safeReject(extractErr as Error);
          }
        }
      });

      zipfile.on('end', () => {
        // The 'end' event fires when all entries have been read from the zip
        // and all file writes have completed (processedCount equals totalEntries).
        if (processedCount === entryCount) {
          resolve();
        }
        // If counts don't match, something went wrong - don't resolve
      });

      zipfile.on('error', (zipErr) => {
        safeReject(zipErr);
      });
    });
  });
}
