import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('packages a root-only version bump using the installed CLI version', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agentman-version-test-'));
  try {
    for (const name of ['dist', 'assets', 'schemas', 'scripts', 'desktop/dist', 'desktop/scripts']) await mkdir(path.join(directory, name), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@ai-agent-manager/cli', version: '0.23.0' }));
    await writeFile(path.join(directory, 'desktop/package.json'), JSON.stringify({ name: 'agentman-desktop', version: '0.22.0', dependencies: { '@ai-agent-manager/cli': 'file:..' } }));
    await writeFile(path.join(directory, 'LICENSE'), 'test fixture');
    await writeFile(path.join(directory, 'scripts/README.npm.md'), 'test fixture');
    await cp(new URL('../scripts/prepare-package.mjs', import.meta.url), path.join(directory, 'desktop/scripts/prepare-package.mjs'));
    // Replace only registry I/O. Run the real staging script and package writes.
    const npm = path.join(directory, 'npm-fixture.mjs');
    await writeFile(npm, `import { mkdir, readFile, writeFile } from 'node:fs/promises';
      if (process.argv[2] === 'pack') process.stdout.write(JSON.stringify([{ filename: 'cli.tgz' }]));
      else {
        await mkdir('node_modules/@ai-agent-manager/cli', { recursive: true });
        await writeFile('node_modules/@ai-agent-manager/cli/package.json', await readFile('../cli/package.json'));
      }
    `);
    await promisify(execFile)(process.execPath, [path.join(directory, 'desktop/scripts/prepare-package.mjs')], {
      env: { ...process.env, npm_execpath: npm }, timeout: 10_000,
    });
    const packaged = JSON.parse(await readFile(path.join(directory, 'desktop/build/app/package.json'), 'utf8'));
    expect(packaged.version).toBe('0.23.0');
    expect(packaged.dependencies['@ai-agent-manager/cli']).toBe('0.23.0');
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
