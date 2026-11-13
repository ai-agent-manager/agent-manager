import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { realpath } from 'node:fs/promises';
import { assertBundleDirectory } from '../../../src/ui-server/validate.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-validate-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

it('accepts a directory with a manifest.json file', async () => {
  await writeFile(path.join(dir, 'manifest.json'), '{}');
  await expect(assertBundleDirectory(dir)).resolves.toBeUndefined();
});

it('accepts a subdirectory containing SKILL.md', async () => {
  await mkdir(path.join(dir, 'my-skill'));
  await writeFile(path.join(dir, 'my-skill', 'SKILL.md'), '# skill');
  await expect(assertBundleDirectory(dir)).resolves.toBeUndefined();
});

it('rejects a directory named manifest.json (not a file)', async () => {
  // A subdirectory named manifest.json must not pass the structural check.
  await mkdir(path.join(dir, 'manifest.json'));
  await expect(assertBundleDirectory(dir)).rejects.toThrow(/not a valid bundle directory/);
});

it('rejects a non-bundle directory', async () => {
  await writeFile(path.join(dir, 'readme.txt'), 'hello');
  await expect(assertBundleDirectory(dir)).rejects.toThrow(/not a valid bundle directory/);
});

it('rejects a path that does not exist', async () => {
  await expect(assertBundleDirectory(path.join(dir, 'missing'))).rejects.toThrow(/does not exist/);
});
