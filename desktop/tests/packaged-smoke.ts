/** Exercise the actual Linux ASAR executable with a private HOME and user data. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { checkout, sandbox } from '../../tests/support/sandbox.js';
import { deadline } from '../../tests/support/lifecycle.js';
import { eventually } from '../../tests/support/http.js';
import { assertRendererSandbox } from './renderer-sandbox.js';

if (process.platform !== 'linux') throw new Error('The packaged smoke currently requires Linux HOME isolation.');
const state = await sandbox();
let child: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let exited: Promise<number | null> | undefined;
let failed = false;
const cleanupErrors: unknown[] = [];
try {
  await mkdir(path.join(state.home, '.agentman'));
  await writeFile(path.join(state.home, '.agentman/config.json'), JSON.stringify({
    installations: {}, sources: [{ kind: 'directory', value: state.source }],
    activeSource: { kind: 'directory', value: state.source }, startupUpdateChecksDisabled: true, telemetryDisabled: true,
  }));
  const executable = path.join(checkout, 'desktop/release/linux-unpacked/agentman-desktop');
  const fuses = await getCurrentFuseWire(executable);
  for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    FuseV1Options.EnableNodeCliInspectArguments, FuseV1Options.GrantFileProtocolExtraPrivileges]) assert.equal(fuses[option], 48, `${FuseV1Options[option]} must be disabled`);
  for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) assert.equal(fuses[option], 49, `${FuseV1Options[option]} must be enabled`);
  // Plain production launch: no Node inspector, test entry point or --no-sandbox.
  // Attach only to Chromium's renderer debugging transport, enabled for this test.
  child = spawn(executable, ['--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${path.join(state.directory, 'userdata')}`], {
    env: { ...process.env, XDG_CONFIG_HOME: path.join(state.directory, 'config') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = new Promise((resolve, reject) => { child!.once('exit', resolve); child!.once('error', reject); });
  void exited.catch(() => {});
  let diagnostic = '';
  child.stderr!.on('data', (data: Buffer) => { diagnostic = (diagnostic + data.toString()).slice(-32_768); });
  const debugUrl = await eventually(async () => {
    assert(child!.exitCode === null && child!.signalCode === null, `Packaged application exited early: ${diagnostic}`);
    return diagnostic.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
  }, (url) => !!url, 20_000);
  browser = await chromium.connectOverCDP(debugUrl!, { timeout: 15_000 });
  page = await eventually(async () => browser!.contexts()[0]?.pages()[0], (value) => !!value);
  assert(page); page.setDefaultTimeout(15_000);
  await page.getByRole('heading', { name: 'Test Skill', exact: true }).waitFor();
  const cdp = await browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const renderers = processInfo.filter((item) => item.type === 'renderer');
  assert(renderers.length > 0);
  for (const renderer of renderers) await assertRendererSandbox(renderer.id);
  await cdp.detach();
  assert.equal(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require), 'undefined');
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Test Skill', exact: true }) }).click();
  await page.getByRole('checkbox', { name: 'Claude Code' }).check();
  await page.getByRole('button', { name: 'Install to 1 tool' }).click();
  await page.getByRole('region', { name: 'Install skill', exact: true }).getByText('succeeded', { exact: true }).waitFor();
  assert.match(await readFile(path.join(state.home, '.claude/skills/test-skill/SKILL.md'), 'utf8'), /Test Skill/);
  assert(JSON.parse(await readFile(path.join(state.home, '.agentman/config.json'), 'utf8')).installations['claude-code']['test-skill']);
  await page.getByRole('button', { name: 'Quit Agent Manager' }).click();
  await page.getByRole('button', { name: 'Quit', exact: true }).click();
  assert.equal(await deadline(exited, 10_000, 'Packaged Quit did not finish.'), 0);
  console.log('Packaged desktop smoke passed: hardened fuses, sandboxed launch, ASAR assets and real skill installation.');
} catch (error) {
  failed = true;
  await mkdir(path.join(checkout, 'desktop/test-results'), { recursive: true });
  await page?.screenshot({ path: path.join(checkout, 'desktop/test-results/packaged-failure.png'), timeout: 5_000 }).catch(() => {});
  throw error;
} finally {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await deadline(exited!, 10_000, 'Packaged desktop cleanup exceeded 10s.', () => child?.kill('SIGKILL'));
    }
  } catch (error) { cleanupErrors.push(error); }
  try { await browser?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await state.close(); } catch (error) { cleanupErrors.push(error); }
  if (failed && cleanupErrors.length) console.error('Additional packaged cleanup failures:', cleanupErrors);
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Packaged desktop cleanup failed.');
