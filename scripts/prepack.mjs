/**
 * prepack.mjs
 *
 * Runs before `npm pack` / `npm publish`.
 * - Replaces README.md with the public-facing README.npm.md so the tarball
 *   contains no internal references. The original is backed up to the OS temp
 *   directory (not the package directory) so npm cannot pick it up.
 * - Strips repository/homepage from package.json for the same reason.
 *
 * postpack.mjs restores both files afterwards.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = tmpdir();

// Back up README.md to temp dir, then replace with the public-facing version.
// README.npm.md lives in scripts/ so npm's automatic readme detection doesn't
// pick it up and include it in the tarball.
await copyFile('README.md', join(tmp, 'agentman-README.md.bak'));
await copyFile('scripts/README.npm.md', 'README.md');
console.log('prepack: swapped README.md → scripts/README.npm.md');

// Back up package.json to temp dir, then strip internal fields
await copyFile('package.json', join(tmp, 'agentman-package.json.bak'));
const pkg = JSON.parse(await readFile('package.json', 'utf-8'));
delete pkg.repository;
delete pkg.homepage;
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('prepack: removed repository and homepage from package.json');
