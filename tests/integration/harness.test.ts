import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { startCli } from '../support/cli.js';
import { assertCallbackPortAvailable, boundedServer } from '../support/lifecycle.js';
import { npmEnvironment } from '../support/npm-env.js';
import { checkout, sandbox } from '../support/sandbox.js';
import { ready } from '../support/http.js';

it('replaces inherited npm cache and config paths before invoking real npm', async () => {
  const state = await sandbox();
  try {
    const outsideCache = path.join(state.directory, 'outside-cache'), outsideConfig = path.join(state.directory, 'outside-npmrc');
    const poison = 'registry=https://example.com/do-not-use/\nfetch-retries=91\n';
    await writeFile(outsideConfig, poison);
    const privateDirectory = path.join(state.directory, 'private-npm');
    const env = await npmEnvironment(privateDirectory, { ...process.env,
      npm_config_cache: outsideCache, npm_config_userconfig: outsideConfig, NPM_CONFIG_GLOBALCONFIG: outsideConfig });
    expect(process.env.npm_execpath).toBeTruthy();
    const { stdout } = await promisify(execFile)(process.execPath, [process.env.npm_execpath!, 'config', 'list', '--json'], {
      cwd: state.directory, env, timeout: 10_000,
    });
    const config = JSON.parse(stdout);
    expect(config.cache).toBe(path.join(privateDirectory, 'cache'));
    expect(config.userconfig).toBe(path.join(privateDirectory, 'npmrc'));
    expect(config.globalconfig).toBe(path.join(privateDirectory, 'global-npmrc'));
    expect(config.registry).toBe('https://registry.npmjs.org/');
    expect(config['fetch-retries']).not.toBe(91);
    expect(await readFile(outsideConfig, 'utf8')).toBe(poison);
    await expect(stat(outsideCache)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await state.close(); }
});

it('fails if the real CLI ignores --no-open, without launching an OS browser', async () => {
  const state = await sandbox();
  try {
    const wrapper = path.join(state.directory, 'ignore-no-open.mjs');
    // Negative control: remove the flag before the actual CLI parses arguments.
    // Everything down to openInBrowser runs normally; only the OS boundary is guarded.
    await writeFile(wrapper, `process.argv = process.argv.filter(arg => arg !== '--no-open');\nawait import(${JSON.stringify(pathToFileURL(path.join(checkout, 'src/index.tsx')).href)});\n`);
    const ui = await startCli({ entry: wrapper, preload: createRequire(import.meta.url).resolve('tsx'), cwd: state.repo, source: state.source });
    try { await ready(ui); }
    finally { await expect(ui.stop()).rejects.toThrow('CLI attempted a browser launch despite --no-open'); }
  } finally { await state.close(); }
}, 30_000);

it('forces a hung server closed and still restores HOME and removes the sandbox', async () => {
  const previousHome = process.env.HOME, previousProfile = process.env.USERPROFILE;
  const state = await sandbox();
  const server = createServer();
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const handle = boundedServer({ server, stop: () => new Promise<void>(() => {}) }, 30);
    await expect(handle.stop()).rejects.toThrow('Test server shutdown exceeded 30ms');
    expect(server.listening).toBe(false);
  } finally { server.close(); await state.close(); }
  expect(process.env.HOME).toBe(previousHome);
  expect(process.env.USERPROFILE).toBe(previousProfile);
  await expect(stat(state.directory)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('diagnoses an occupied callback port without disturbing its owner', async () => {
  const owner = createServer();
  await new Promise<void>((resolve) => owner.listen(0, '127.0.0.1', resolve));
  const port = (owner.address() as { port: number }).port;
  try {
    await expect(assertCallbackPortAvailable(port)).rejects.toThrow(`OAuth test needs callback port ${port}. Finish the other agentman login or auth test suite, then retry.`);
    expect(owner.listening).toBe(true);
  } finally { await new Promise<void>((resolve) => owner.close(() => resolve())); }
  await assertCallbackPortAvailable(port);
});
