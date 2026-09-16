/** Requires the repository's Imposter mock on localhost:8080 and built UI assets.
 * Real browser, OAuth callback and filesystem token store; no real account/keychain.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const home = await mkdtemp(path.join(os.tmpdir(), 'agentman-browser-auth-'));
const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS: process.env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS = 'true';
const { _disableKeychain } = await import('../../src/auth/token-store.js');
_disableKeychain();
const { startUiServer } = await import('../../src/ui-server/index.js');
const ui = await startUiServer({ port: 0, cwd: home, startupSource: 'http://localhost:8080' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(ui.url);
  const initial = page.getByRole('region', { name: 'Load catalogue', exact: true });
  await initial.getByRole('link', { name: /Open sign-in page/ }).waitFor();
  const status = await fetch(new URL('/api/auth', ui.url), { headers: { authorization: `Bearer ${ui.token}` }, signal: AbortSignal.timeout(2000) });
  assert.equal((await status.json()).authenticated, false);
  await initial.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const activity = page.getByRole('region', { name: 'Sign in', exact: true });
  const popupPromise = page.waitForEvent('popup');
  await activity.getByRole('link', { name: /Open sign-in page/ }).click();
  const popup = await popupPromise;
  await popup.locator('input[name="username"]').fill('alice');
  await popup.locator('input[name="password"]').fill('password123');
  await popup.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Find your next skill', exact: true }).waitFor();
  assert((await readdir(path.join(home, '.agentman', 'auth'))).some((name) => name.endsWith('.json')));
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  await popup.close();
  await page.getByRole('link', { name: 'Versions', exact: true }).click();
  await page.getByRole('button', { name: 'Browse remote versions', exact: true }).click();
  const remote = page.getByRole('region', { name: 'Remote versions', exact: true });
  await remote.getByRole('button', { name: 'Download 0.1.1 from mock-bundle', exact: true }).click();
  await page.getByRole('region', { name: 'Download bundle', exact: true }).getByText('succeeded', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal((await readdir(path.join(home, '.agentman', 'auth'))).filter((name) => name.endsWith('.json')).length, 0);
  assert.deepEqual(errors, []);
  console.log('Mock OAuth browser smoke passed: cancel, retry, explicit login popup, catalogue, named-source versions/download and logout.');
} finally {
  await browser?.close(); await ui.stop();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
}
