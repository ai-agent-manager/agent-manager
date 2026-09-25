import { exerciseUi } from './workflow.js';
/** Real browser + real server smoke. Run after npm run build:web-ui:
 * node --import tsx tests/browser/ui-smoke.ts
 * Requires the Playwright Chromium browser installed in the development cache.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const home = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-browser-'));
const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: process.env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS = 'true';
await mkdir(path.join(home, 'repo', '.git'), { recursive: true });
const { importLocalBundle } = await import('../../src/bundle/importer.js');
const localSource = path.join(home, 'bundle');
await cp(path.resolve('tests/fixtures/valid-bundle'), localSource, { recursive: true });
const manifestPath = path.join(localSource, 'manifest.json');
const originalManifest = await readFile(manifestPath, 'utf8');
await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(originalManifest), version: 'browser-next' }));
await importLocalBundle(localSource);
await writeFile(manifestPath, originalManifest);
const { startUiServer } = await import('../../src/ui-server/index.js');
const start = process.argv.includes('--dev') ? (await import('../../scripts/dev-ui.js')).startDevUi : startUiServer;
const server = await start({ port: 0, cwd: path.join(home, 'repo'), startupSource: localSource });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await exerciseUi(page, server, home);
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: bootstrap, catalogue, install, per-skill/global versions, info, reload, remove, settings, sources, mobile layout.');
} finally {
  await browser?.close(); await server.stop();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
}
