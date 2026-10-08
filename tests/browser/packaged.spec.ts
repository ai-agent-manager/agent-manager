import { npmEnvironment } from '../support/npm-env.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { checkout } from '../support/sandbox.js';
import { startCli } from '../support/cli.js';
import { exerciseUi } from './workflow.js';

const exec = promisify(execFile);
test('installed npm tarball serves assets and installs/removes outside the checkout without optional dependencies', async ({ page, state, cleanup }) => {
  test.setTimeout(180_000);
  const staging = path.join(state.directory, 'package'), consumer = path.join(state.directory, 'consumer'), temporary = path.join(state.directory, 'pack-tmp');
  await Promise.all([mkdir(staging), mkdir(consumer), mkdir(temporary)]);
  // Run the real pack lifecycle in a copy: its README/package rewrites and
  // temporary backups must not touch the checkout or another developer's pack.
  for (const name of ['dist', 'assets', 'schemas', 'scripts', 'package.json', 'README.md', 'LICENSE']) {
    await cp(path.join(checkout, name), path.join(staging, name), { recursive: true });
  }
  const npm = process.env.npm_execpath;
  expect(npm, 'Run browser tests through npm so its portable CLI entry point is available').toBeTruthy();
  const env = await npmEnvironment(temporary);
  const packed = await exec(process.execPath, [npm!, 'pack', '--json', '--pack-destination', consumer], { cwd: staging, env, timeout: 60_000 });
  // Lifecycle scripts write progress before npm's JSON report.
  const reportStart = packed.stdout.search(/^\s*\[/m);
  expect(reportStart).toBeGreaterThanOrEqual(0);
  const metadata = JSON.parse(packed.stdout.slice(reportStart));
  expect(metadata[0].files.some((file: { path: string }) => file.path === 'assets/web-ui/index.html')).toBe(true);
  expect(metadata[0].files.some((file: { path: string }) => file.path.startsWith('tests/'))).toBe(false);
  await exec(process.execPath, [npm!, 'install', '--omit=optional', '--no-audit', '--no-fund', '--package-lock=false', path.join(consumer, metadata[0].filename)], { cwd: consumer, env, timeout: 90_000 });
  const installed = path.join(consumer, 'node_modules/@ai-agent-manager/cli');
  await expect(stat(path.join(consumer, 'node_modules/playwright'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(installed, 'assets/web-ui/index.html'), 'utf8')).toContain('/assets/');
  const ui = await startCli({ entry: path.join(installed, 'dist/index.js'), cwd: consumer, source: state.source });
  cleanup(() => ui.stop());
  await exerciseUi(page, ui, state.home, false);
});
