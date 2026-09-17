/** Real Electron/HTTP/filesystem smoke. Only native dialogs and OS URL launch
 * are intercepted; no real keychain, browser tab or user state is touched. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type ElectronApplication } from 'playwright';
import { withMutation } from '../../src/lib/mutation.js';
import { sandbox, checkout, barrier } from '../../tests/support/sandbox.js';
import { provider } from '../../tests/support/provider.js';
import { api, eventually, ready } from '../../tests/support/http.js';
import { assertCallbackPortAvailable, deadline } from '../../tests/support/lifecycle.js';
import { exerciseUi } from '../../tests/browser/workflow.js';
import { assertRendererSandbox } from './renderer-sandbox.js';

await assertCallbackPortAvailable();
const state = await sandbox();
let app: ElectronApplication | undefined;
let idp: Awaited<ReturnType<typeof provider>> | undefined;
let failed = false;
const cleanupErrors: unknown[] = [];
try {
  const wrapper = path.join(state.directory, 'electron-test.mjs');
  const userdata = path.join(state.directory, 'electron-data'); await mkdir(userdata);
  await writeFile(wrapper, `import { app, shell, dialog } from 'electron';
    app.on('web-contents-created', (_event, contents) => contents.setBackgroundThrottling(false));
    app.setPath('home', ${JSON.stringify(state.home)});
    app.setPath('userData', ${JSON.stringify(userdata)});
    globalThis.externalUrls = []; globalThis.pickerCalls = 0; globalThis.navigationAttempts = [];
    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-frame-navigate', (event) => {
        if (event.isMainFrame) setImmediate(() => globalThis.navigationAttempts.push({ url: event.url, prevented: event.defaultPrevented }));
      });
    });
    shell.openExternal = async (url) => { globalThis.externalUrls.push(url); };
    dialog.showOpenDialog = async () => { globalThis.pickerCalls++; return { canceled: false, filePaths: [${JSON.stringify(state.repo)}] }; };
    dialog.showErrorBox = (title, message) => { console.error(title, message); };
    const { _disableKeychain } = await import(${JSON.stringify(pathToFileURL(path.join(checkout, 'dist/auth/token-store.js')).href)});
    _disableKeychain();
    await import(${JSON.stringify(pathToFileURL(path.join(checkout, 'desktop/dist/main.js')).href)});
  `);
  app = await electron.launch({ executablePath: createRequire(import.meta.url)('electron') as string, chromiumSandbox: true,
    args: [...(process.platform === 'linux' ? ['--disable-gpu'] : []), wrapper],
    env: { ...process.env, AGENTMAN_DESKTOP_SOURCE: state.source, AGENTMAN_DESKTOP_ALLOW_LOOPBACK_AUTH: '1' }, timeout: 20_000 });
  await promisify(execFile)(createRequire(import.meta.url)('electron') as string, [wrapper], { env: { ...process.env, AGENTMAN_DESKTOP_SOURCE: state.source }, timeout: 15_000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  assert(!app.process().spawnargs.includes('--no-sandbox'));
  await assertRendererSandbox(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId()));
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  const endpoint = { url: page.url(), token: await page.evaluate(() => sessionStorage.getItem('agentman.token')) as string };
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { agentmanDesktop: { pickDirectory: unknown } }).agentmanDesktop.pickDirectory), 'function');
  assert.equal(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process), 'undefined');
  for (const url of ['file:///example/private', 'data:text/html,bad', 'javascript:alert(1)', 'agentman:run', 'https://evil.example.com/']) {
    await page.evaluate((target) => { window.open(target); }, url);
  }
  assert.equal(await app.evaluate(() => (globalThis as unknown as { externalUrls: string[] }).externalUrls.length), 0);
  assert.equal(app.windows().length, 1);
  const originalOrigin = new URL(page.url()).origin;
  await page.evaluate(() => { const link = document.createElement('a'); link.href = 'https://evil.example.com/'; link.textContent = 'Untrusted destination'; document.body.append(link); link.click(); link.remove(); });
  const attempts = await eventually(() => app!.evaluate(() => (globalThis as unknown as { navigationAttempts: { url: string; prevented: boolean }[] }).navigationAttempts), (items) => items.length > 0);
  assert.equal(attempts.at(-1)!.prevented, true); // After all main-process navigation listeners ran.
  assert.equal(await app.evaluate(({ BrowserWindow }) => new URL(BrowserWindow.getAllWindows()[0]!.webContents.getURL()).origin), originalOrigin);
  assert.equal(await app.evaluate(() => (globalThis as unknown as { externalUrls: string[] }).externalUrls.length), 0);
  // about:blank skips will-navigate: wait for the committed navigation and recovery.
  const blank = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() && frame.url() === 'about:blank' });
  await page.evaluate(() => { location.href = 'about:blank'; });
  await blank;
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => new URL(BrowserWindow.getAllWindows()[0]!.webContents.getURL()).origin), originalOrigin);
  // Exercise the installed UI paths against the real local server.
  await exerciseUi(page, endpoint, state.home, false);
  await page.setViewportSize({ width: 1240, height: 880 });
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Test Skill', exact: true }) }).click();
  await page.getByLabel('Install scope').selectOption('repo');
  await page.getByRole('button', { name: 'Browse repository root' }).click();
  await eventually(() => page.getByLabel('Repository root', { exact: true }).inputValue(), (value) => value === state.repo);
  await page.getByRole('button', { name: 'Load repository catalogue' }).click();
  await page.getByRole('checkbox', { name: 'Claude Code' }).check();
  await page.getByRole('button', { name: 'Install to 1 tool' }).click();
  await page.getByRole('region', { name: 'Install skill', exact: true }).getByText('succeeded', { exact: true }).waitFor();
  assert.match(await readFile(path.join(state.repo, '.claude/skills/test-skill/SKILL.md'), 'utf8'), /Test Skill/);
  assert.equal(JSON.parse(await readFile(path.join(state.repo, '.agentman.json'), 'utf8')).installations['claude-code']['test-skill'].sourcePin.bundleVersion, 'abc1234def5678');
  // Real OAuth state/PKCE/callback, with the system-browser boundary intercepted.
  idp = await provider();
  assert.equal((await api(endpoint, '/api/session/load', 'POST', { source: idp.url })).status, 202);
  const link = page.getByRole('link', { name: /Open sign-in page/ }); await link.waitFor();
  const authorize = await link.getAttribute('href'); assert(authorize);
  await page.evaluate((url) => { window.open(`${url}&forged=1`); }, authorize);
  assert.equal(await app.evaluate(() => (globalThis as unknown as { externalUrls: string[] }).externalUrls.length), 0);
  await link.click();
  const launched = await eventually(() => app!.evaluate(() => (globalThis as unknown as { externalUrls: string[] }).externalUrls), (urls) => urls.length === 1);
  assert.equal(launched[0], authorize);
  const consent = await (await fetch(authorize)).text();
  const attempt = consent.match(/name="attempt" value="([^"]+)"/)?.[1]; assert(attempt);
  const approved = await fetch(new URL('/approve', idp.url), { method: 'POST', body: new URLSearchParams({ attempt }), redirect: 'manual' });
  assert.equal(approved.status, 303);
  await fetch(approved.headers.get('location')!);
  await ready(endpoint);
  assert.equal(idp.control.exchanges, 1);
  await page.evaluate((url) => { window.open(url); }, authorize);
  assert.equal(await app.evaluate(() => (globalThis as unknown as { externalUrls: string[] }).externalUrls.length), 1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await api(endpoint, '/api/session/load', 'POST', { source: state.source });
  const session = await ready(endpoint), skill = session.catalogue[0]!;
  const entered = barrier(), release = barrier();
  const held = withMutation(async () => { entered.release(); await release.promise; });
  await entered.promise;
  const closed = app.waitForEvent('close');
  try {
    const install = await api(endpoint, '/api/installs', 'POST', { sessionRevision: session.sessionRevision,
      skillId: skill.skillId, installKey: skill.candidates[0]!.installKey, scope: 'system', toolIds: ['claude-code'] });
    const { jobId } = await install.json(); assert.equal(install.status, 202);
    await eventually(async () => (await (await api(endpoint, `/api/jobs/${jobId}`)).json()).phase, (phase) => phase === 'commit');
    await page.getByRole('button', { name: 'Quit Agent Manager' }).click();
    await page.getByRole('button', { name: 'Quit', exact: true }).click();
    await eventually(async () => (await api(endpoint, '/api/session')).status, (status) => status === 503);
    assert.equal(app.process().exitCode, null); // A running commit keeps Electron alive.
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle()), 'Agent Manager — finishing operations…');
  } finally { release.release(); await held; }
  await deadline(closed, 10_000, 'Desktop Quit did not drain and close.');
  assert.match(await readFile(path.join(state.home, '.claude/skills/test-skill/SKILL.md'), 'utf8'), /Test Skill/);
  assert(JSON.parse(await readFile(path.join(state.home, '.agentman/config.json'), 'utf8')).installations['claude-code']['test-skill']);
  console.log('Desktop smoke passed: isolated renderer, blocked external launches, real installs, native picker IPC, OAuth PKCE and graceful Quit.');
} catch (error) {
  failed = true;
  const diagnostics = path.join(checkout, 'desktop/test-results'); await mkdir(diagnostics, { recursive: true });
  await app?.windows()[0]?.screenshot({ path: path.join(diagnostics, 'smoke-failure.png'), timeout: 5_000 }).catch(() => {});
  throw error;
} finally {
  try { if (app) await deadline(app.close(), 10_000, 'Desktop test cleanup exceeded 10s.', () => { app?.process().kill('SIGKILL'); }); } catch (error) { cleanupErrors.push(error); }
  try { await idp?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await state.close(); } catch (error) { cleanupErrors.push(error); }
  if (failed && cleanupErrors.length) console.error('Additional desktop cleanup failures:', cleanupErrors);
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Desktop smoke cleanup failed.');
