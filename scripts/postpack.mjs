/**
 * postpack.mjs
 *
 * Runs after `npm pack` / `npm publish` (success or failure).
 * Restores README.md from the backup written to the OS temp directory by
 * prepack.mjs.
 */

import { copyFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = tmpdir();

await copyFile(join(tmp, 'agentman-README.md.bak'), 'README.md');
await unlink(join(tmp, 'agentman-README.md.bak'));
console.log('postpack: restored README.md');
