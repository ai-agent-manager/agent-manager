import { boundedServer } from '../support/lifecycle.js';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { exerciseUi } from './workflow.js';
import { importLocalBundle } from '../../src/bundle/importer.js';
import { startDevUi } from '../../scripts/dev-ui.js';
import { checkout } from '../support/sandbox.js';

async function cacheNextVersion(source: string) {
  const manifest = path.join(source, 'manifest.json'), original = await readFile(manifest, 'utf8');
  await writeFile(manifest, JSON.stringify({ ...JSON.parse(original), version: 'browser-next' }));
  try { await importLocalBundle(source); } finally { await writeFile(manifest, original); }
}
test('production UI: bootstrap, install, versions, reload, remove and mobile layout', async ({ page, app, state }) => {
  await cacheNextVersion(state.source);
  const ui = await app();
  await exerciseUi(page, ui, state.home);
});
test('development UI: occupied default port, same-origin API/SSE and actual HMR', async ({ page, state, cleanup }) => {
  await cacheNextVersion(state.source);
  const root = path.join(state.directory, 'web-ui');
  await cp(path.join(checkout, 'web-ui'), root, { recursive: true, filter: (source) => !['node_modules', 'dist'].includes(path.basename(source)) && !path.basename(source).startsWith('.env') });
  const dependencies = path.join(checkout, 'web-ui/node_modules'), localDependencies = path.join(root, 'node_modules');
  await mkdir(localDependencies);
  // Keep Vite's .vite-temp config bundle inside the sandbox as well as cacheDir.
  for (const entry of await readdir(dependencies, { withFileTypes: true })) {
    if (entry.name.startsWith('.vite')) continue;
    const source = path.join(dependencies, entry.name), target = path.join(localDependencies, entry.name);
    if (entry.isDirectory()) await symlink(source, target, 'junction');
    else await cp(source, target);
  }
  const configPath = path.join(root, 'vite.config.ts');
  const originalConfig = await readFile(configPath, 'utf8');
  const isolatedConfig = originalConfig.replace('defineConfig({', `defineConfig({ cacheDir: ${JSON.stringify(path.join(root, '.vite'))},`);
  expect(isolatedConfig).not.toBe(originalConfig);
  await writeFile(configPath, isolatedConfig);
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  cleanup(() => new Promise<void>((resolve) => occupied.close(() => resolve())));
  const port = (occupied.address() as { port: number }).port;
  // This configured default is owned by the test, avoiding other local previews.
  const ui = boundedServer(await startDevUi({ port, cwd: state.repo, startupSource: state.source, root }));
  cleanup(() => ui.stop());
  expect(ui.port).not.toBe(port);
  const origin = new URL(ui.url).origin;
  const requests: string[] = [], sockets: string[] = [];
  page.on('request', (request) => { if (request.url().startsWith('http')) requests.push(request.url()); });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  await page.goto(ui.url);
  await expect(page.getByRole('link', { name: 'Agent Manager home' })).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  expect(sockets.every((url) => new URL(url).host === new URL(origin).host)).toBe(true);
  const navigationStart = await page.evaluate(() => performance.timeOrigin);
  const appPath = path.join(root, 'src/App.tsx');
  await writeFile(appPath, (await readFile(appPath, 'utf8')).replace('<span>Agent Manager</span>', '<span>Agent Manager HMR</span>'));
  await expect(page.getByText('Agent Manager HMR', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(navigationStart);
  await exerciseUi(page, ui, state.home);
  expect(requests.some((url) => url.endsWith('/api/events'))).toBe(true);
  expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
});
