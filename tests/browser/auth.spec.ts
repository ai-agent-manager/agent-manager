import { createServer } from 'node:http';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { provider } from '../support/provider.js';
import { api, events, ready } from '../support/http.js';
import { OAUTH_CALLBACK_PORT } from '../../src/auth/callback-server.js';

async function signIn(page: import('playwright').Page, label: string) {
  const popup = page.waitForEvent('popup');
  await page.getByRole('region', { name: label, exact: true }).getByRole('link', { name: /Open sign-in page/ }).click();
  const authorization = await popup;
  await authorization.getByRole('button', { name: 'Authorize test account' }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await authorization.close();
}
test('real OAuth cancel frees the callback port; explicit retry verifies PKCE and logout deletes tokens', async ({ page, app, state, oauthPort, cleanup }) => {
  void oauthPort;
  const idp = await provider();
  cleanup(() => idp.close());
  const ui = await app({ startupSource: idp.url });
  await page.goto(ui.url);
  const activity = page.getByRole('region', { name: 'Load catalogue', exact: true });
  await expect(activity.getByRole('link', { name: /Open sign-in page/ })).toBeVisible();
  expect(idp.control.authorizationVisits).toBe(0); // no automatic popup
  await activity.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(activity).toHaveCount(0);
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', resolve); });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  expect((await (await api(ui, '/api/session')).json()).state).toBe('idle');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await signIn(page, 'Sign in');
  const session = await ready(ui);
  expect(session.catalogue).toHaveLength(1); expect(idp.control.exchanges).toBe(1);
  expect((await readdir(path.join(state.home, '.agentman/auth'))).filter((name) => name.endsWith('.json'))).toHaveLength(1);
  for (const endpoint of ['/api/auth', '/api/session', `/api/jobs/${session.loadJobId}`]) {
    const response = await api(ui, endpoint); expect(response.status).toBe(200);
    const envelope = await response.text();
    expect(envelope).not.toContain(idp.bearer); expect(envelope).not.toContain(idp.refresh);
  }
  const stream = await events(ui);
  try { const frame = JSON.stringify(await stream.read()); expect(frame).not.toContain(idp.bearer); expect(frame).not.toContain(idp.refresh); }
  finally { await stream.close(); }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await readdir(path.join(state.home, '.agentman/auth'))).filter((name) => name.endsWith('.json'))).toHaveLength(0);
});
test('membership failure hides the catalogue and rejects a forged install, then reload recovers', async ({ page, app, oauthPort, cleanup }) => {
  void oauthPort;
  const idp = await provider();
  cleanup(() => idp.close());
  idp.control.membershipFails = true;
  const ui = await app({ startupSource: idp.url });
  await page.goto(ui.url); await signIn(page, 'Load catalogue');
  await expect(page.getByRole('heading', { name: 'Your catalogue is empty' })).toBeVisible();
  await expect(page.getByText('Project memberships could not be verified.', { exact: false })).toBeVisible();
  const denied = await ready(ui);
  expect(denied.membership.state).toBe('error'); expect(denied.catalogue).toEqual([]);
  const attempt = await api(ui, '/api/installs', 'POST', { sessionRevision: denied.sessionRevision, skillId: 'test-skill', installKey: 'browser-fixture/test-skill', scope: 'system', toolIds: ['claude-code'] });
  expect(attempt.status).toBe(403);
  idp.control.membershipFails = false;
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'test-skill', exact: true })).toBeVisible();
  const recovered = await ready(ui);
  expect(recovered.membership.state).toBe('ready');
  expect(recovered.catalogue[0]!.candidates[0]!.installKey).toBe('browser-fixture/test-skill');
  expect(idp.control.exchanges).toBe(1); // cached token, no second user login
});
