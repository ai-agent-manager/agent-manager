/** Real browser + real server smoke. Run after npm run build:web-ui:
 * node --import tsx tests/browser/ui-smoke.ts
 * Requires the Playwright Chromium browser installed in the development cache.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const home = await mkdtemp(path.join(os.tmpdir(), 'agentman-browser-'));
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
  await page.goto(server.url);
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  await page.screenshot({ path: path.join(os.tmpdir(), 'agentman-web-ui-catalogue.png'), fullPage: true });
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Test Skill', exact: true }) }).click();
  await page.getByRole('checkbox', { name: 'Claude Code' }).check();
  await page.getByRole('button', { name: 'Install to 1 tool' }).click();
  await page.getByLabel('Install skill', { exact: true }).getByText('succeeded', { exact: true }).waitFor();
  const destination = path.join(home, '.claude', 'skills', 'test-skill');
  assert.match(await readFile(path.join(destination, 'SKILL.md'), 'utf8'), /Test Skill/);
  const config = JSON.parse(await readFile(path.join(home, '.agentman', 'config.json'), 'utf8'));
  assert.equal(config.installations['claude-code']['test-skill'].sourcePin.bundleVersion, 'abc1234def5678');
  await page.getByRole('link', { name: 'Skill versions', exact: true }).click();
  const installation = page.getByLabel('Installation', { exact: true });
  await page.getByRole('heading', { name: 'Skill versions', exact: true }).waitFor();
  await installation.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Use version browser-next', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm version', exact: true }).click();
  await page.getByRole('region', { name: 'Change skill version', exact: true }).getByText('succeeded', { exact: true }).waitFor();
  const switched = JSON.parse(await readFile(path.join(home, '.agentman', 'config.json'), 'utf8'));
  assert.equal(switched.installations['claude-code']['test-skill'].sourcePin.bundleVersion, 'browser-next');
  await page.getByRole('link', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: 'Use version browser-next', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm version', exact: true }).click();
  await page.getByRole('region', { name: 'Select bundle', exact: true }).getByText('succeeded', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Installed', exact: true }).click();
  await page.getByRole('button', { name: /^Info /, exact: true }).click();
  await page.getByRole('dialog', { name: 'Installation details' }).waitFor();
  await page.reload();
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  await page.getByRole('button', { name: /^Remove /, exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal' }).click();
  await page.getByRole('heading', { name: 'No installed skills' }).waitFor();
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const telemetry = page.getByRole('checkbox', { name: /Share anonymous usage data/ });
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
  await telemetry.uncheck();
  assert.equal((await saved).status(), 200);
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Sources', exact: true }).click();
  await page.getByRole('heading', { name: 'Add a source' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: path.join(os.tmpdir(), 'agentman-web-ui-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: bootstrap, catalogue, install, per-skill/global versions, info, reload, remove, settings, sources, mobile layout.');
} finally {
  await browser?.close(); await server.stop();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
}
