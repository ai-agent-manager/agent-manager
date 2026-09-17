import assert from 'node:assert/strict';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { api, type Endpoint } from '../support/http.js';

/** Shared by checkout, dev and installed-tarball browsers: installs and versions use the UI. */
export async function exerciseUi(page: Page, endpoint: Endpoint, home: string, versions = true) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(endpoint.url);
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('agentman.token')), null);
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Test Skill', exact: true }) }).click();
  await page.getByRole('checkbox', { name: 'Claude Code' }).check();
  await page.getByRole('button', { name: 'Install to 1 tool' }).click();
  await page.getByLabel('Install skill', { exact: true }).getByText('succeeded', { exact: true }).waitFor();
  const destination = path.join(home, '.claude', 'skills', 'test-skill');
  assert.match(await readFile(path.join(destination, 'SKILL.md'), 'utf8'), /Test Skill/);
  const config = JSON.parse(await readFile(path.join(home, '.agentman', 'config.json'), 'utf8'));
  const record = config.installations['claude-code']['test-skill'];
  assert.equal(record.sourcePin.bundleVersion, 'abc1234def5678');
  if (record.method === 'symlink') assert.equal(await realpath(destination), await realpath(path.join(home, '.agentman/bundles/abc1234def5678/test-skill')));
  else assert.equal(record.method, 'copy');
  if (versions) {
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
  }
  await page.getByRole('link', { name: 'Installed', exact: true }).click();
  await page.getByRole('button', { name: /^Info /, exact: true }).click();
  await page.getByRole('dialog', { name: 'Installation details' }).waitFor();
  await page.reload();
  assert.equal(new URL(page.url()).searchParams.has('token'), false);
  await page.getByRole('button', { name: /^Remove /, exact: true }).click();
  await page.getByRole('button', { name: 'Confirm removal' }).click();
  await page.getByRole('heading', { name: 'No installed skills' }).waitFor();
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(path.join(home, '.agentman/config.json'), 'utf8')).installations['claude-code']?.['test-skill'], undefined);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const telemetry = page.getByRole('checkbox', { name: /Share anonymous usage data/ });
  if (await telemetry.isDisabled()) {
    assert.equal(await telemetry.isChecked(), false);
    // Environment overrides deliberately disable both controls. Still exercise
    // the real settings write and verify persistence rather than skipping PATCH.
    const saved = await api(endpoint, '/api/settings', 'PATCH', { telemetryDisabled: true, startupUpdateChecksDisabled: true });
    assert.equal(saved.status, 200);
    const settings = JSON.parse(await readFile(path.join(home, '.agentman/config.json'), 'utf8'));
    assert.equal(settings.telemetryDisabled, true);
    assert.equal(settings.startupUpdateChecksDisabled, true);
  }
  else {
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
    await telemetry.uncheck();
    assert.equal((await saved).status(), 200);
  }
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Sources', exact: true }).click();
  await page.getByRole('heading', { name: 'Add a source' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await page.getByRole('heading', { name: 'Find your next skill' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
}
