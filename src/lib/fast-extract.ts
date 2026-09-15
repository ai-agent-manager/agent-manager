/**
 * Fast ZIP extraction using yauzl streaming reader.
 * Used on Mac/Linux. Windows uses PowerShell extraction.
 */

import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';

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
        } else {
          // File entry
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

              writeStream.on('finish', () => {
                processedCount++;
                // Check if we've processed all entries
                if (processedCount >= entryCount) {
                  resolve();
                } else {
                  zipfile.readEntry();
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
        // The 'end' event fires when all entries have been READ from the zip,
        // but file writes may still be pending. Only resolve if all entries
        // have been PROCESSED (written to disk).
        if (processedCount >= entryCount) {
          resolve();
        }
        // Otherwise, the last writeStream.on('finish') will call resolve()
      });

      zipfile.on('error', (zipErr) => {
        safeReject(zipErr);
      });
    });
  });
}
