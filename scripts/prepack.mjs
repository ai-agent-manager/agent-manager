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

import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = tmpdir();

// npm copies bundleDependencies from node_modules and silently omits missing
// ones, which ships a CLI that cannot start. Fail before touching any files.
const manifest = JSON.parse(await readFile('package.json', 'utf-8'));
const missing = [];
for (const name of manifest.bundleDependencies ?? []) {
  try {
    await access(join('node_modules', name, 'package.json'));
  } catch {
    missing.push(name);
  }
}
if (missing.length > 0) {
  console.error(`prepack: bundled dependencies missing from node_modules: ${missing.join(', ')}. Run npm ci before packing.`);
  process.exit(1);
}

// Back up README.md to temp dir, then replace with the public-facing version.
// README.npm.md lives in scripts/ so npm's automatic readme detection doesn't
// pick it up and include it in the tarball.
await copyFile('README.md', join(tmp, 'agentman-README.md.bak'));
await copyFile('scripts/README.npm.md', 'README.md');
console.log('prepack: swapped README.md → scripts/README.npm.md');

// Back up package.json to temp dir, then strip internal fields
await copyFile('package.json', join(tmp, 'agentman-package.json.bak'));
const pkg = JSON.parse(await readFile('package.json', 'utf-8'));
delete pkg.homepage;
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('prepack: removed homepage from package.json');
