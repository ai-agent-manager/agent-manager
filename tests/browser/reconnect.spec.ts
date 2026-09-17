import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { api, finished, ready } from '../support/http.js';
import { barrier } from '../support/sandbox.js';
import { withMutation } from '../../src/lib/mutation.js';

async function clickInstall(page: import('playwright').Page) {
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Test Skill', exact: true }) }).click();
  await page.getByRole('checkbox', { name: 'Claude Code' }).check();
  const response = page.waitForResponse((response) => response.url().endsWith('/api/installs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Install to 1 tool' }).click();
  return (await (await response).json()).jobId as string;
}
test('a completed job is recovered when the first event stream attaches late', async ({ page, app, state }) => {
  const ui = await app(), stream = barrier(), requested = barrier();
  await ready(ui);
  const entered = barrier(), release = barrier();
  const held = withMutation(async () => { entered.release(); await release.promise; }); await entered.promise;
  await page.route('**/api/events', async (route) => { requested.release(); await stream.promise; await route.continue().catch(() => {}); });
  try {
    await page.goto(ui.url); await requested.promise;
    const jobId = await clickInstall(page);
    const activity = page.getByRole('region', { name: 'Install skill', exact: true });
    await expect(activity.getByText('running', { exact: true })).toBeVisible();
    release.release(); await held;
    expect((await finished(ui, jobId)).state).toBe('succeeded');
    // The fallback GET saw running; only the first SSE snapshot can reconcile it.
    await expect(activity.getByText('running', { exact: true })).toBeVisible();
    stream.release();
    await expect(page.getByRole('region', { name: 'Install skill', exact: true }).getByText('succeeded', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('link', { name: 'Installed', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Info / })).toBeVisible();
    expect(await readFile(path.join(state.home, '.claude/skills/test-skill/SKILL.md'), 'utf8')).toContain('Test Skill');
  } finally { release.release(); await held; stream.release(); }
});
test('a job finishing while disconnected is reconciled by the reconnect snapshot', async ({ page, context, app, state }) => {
  const ui = await app();
  const streams = new Set<import('node:http').ServerResponse>();
  ui.server.on('request', (req, res) => { if (req.url === '/api/events') { streams.add(res); res.once('close', () => streams.delete(res)); } });
  await page.goto(ui.url);
  await expect.poll(() => streams.size).toBe(1);
  const entered = barrier(), release = barrier();
  const held = withMutation(async () => { entered.release(); await release.promise; }); await entered.promise;
  try {
    const jobId = await clickInstall(page);
    expect((await (await api(ui, `/api/jobs/${jobId}`)).json()).state).toBe('running');
    await expect(page.getByRole('region', { name: 'Install skill', exact: true }).getByText('running', { exact: true })).toBeVisible();
    await context.setOffline(true);
    for (const stream of streams) stream.destroy();
    await expect(page.getByText('Connection lost. Reconnecting and refreshing activity…')).toBeVisible();
    release.release(); await held;
    expect((await finished(ui, jobId)).state).toBe('succeeded');
    await context.setOffline(false);
    await expect(page.getByRole('region', { name: 'Install skill', exact: true }).getByText('succeeded', { exact: true })).toBeVisible();
    await expect(page.getByText('Connection lost. Reconnecting and refreshing activity…')).toHaveCount(0);
    const config = JSON.parse(await readFile(path.join(state.home, '.agentman/config.json'), 'utf8'));
    expect(config.installations['claude-code']['test-skill'].sourcePin.bundleVersion).toBe('abc1234def5678');
  } finally { release.release(); await held; await context.setOffline(false); }
});
