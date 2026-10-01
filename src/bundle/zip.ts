import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { extract } from 'zip-lib';

/**
 * Extract a zip archive into `dir`.
 *
 * Replaces `extract-zip`, whose `yauzl` 2 dependency hangs part-way through
 * archives on Node 26. `zip-lib` runs on `yauzl` 3, which has the fix.
 * - `__MACOSX/` resource-fork entries are skipped.
 * - Entries that would land outside `dir`, including through a symlink
 *   extracted earlier, reject the archive.
 * - Symlink entries are recreated as symlinks. Callers that must not trust
 *   them run removeEscapingSymlinks() afterwards.
 */
export async function extractZip(zipPath: string, dir: string): Promise<void> {
  if (!path.isAbsolute(dir)) {
    throw new Error('Target directory is expected to be absolute');
  }
  await mkdir(dir, { recursive: true });
  // zip-lib refuses every write when the target path itself passes through a
  // symlink (macOS os.tmpdir() is under /var -> /private/var).
  const root = await realpath(dir);

  await extract(zipPath, root, {
    symlinkAsFileOnWindows: false,
    onEntry: (event) => {
      if (event.entryName.startsWith('__MACOSX/')) event.preventDefault();
    },
  });
}
