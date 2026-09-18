import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures.js';

test('appearance follows the system, overrides it explicitly, and survives a new application origin', async ({ page, app, state }) => {
  const ui = await app();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(ui.url);
  const appearance = page.getByRole('group', { name: 'Appearance' });
  const light = appearance.getByRole('radio', { name: 'Light', exact: true });
  const dark = appearance.getByRole('radio', { name: 'Dark', exact: true });
  const system = appearance.getByRole('radio', { name: 'System', exact: true });
  const root = page.locator('html');
  await expect(light).toBeEnabled();
  await expect(system).toBeChecked();
  await expect(root).toHaveCSS('color-scheme', 'dark');

  const choose = async (value: 'Light' | 'Dark' | 'System') => {
    const saved = page.waitForResponse((response) => response.url().endsWith('/api/settings') && response.request().method() === 'PATCH');
    await appearance.getByText(value, { exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(light).toBeEnabled();
  };
  await choose('Light');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await expect(root).toHaveCSS('background-color', 'rgb(246, 248, 246)');
  await page.emulateMedia({ colorScheme: 'light' });
  await choose('Dark');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(root).toHaveCSS('background-color', 'rgb(23, 34, 28)');
  await choose('System');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('color-scheme', 'light');
  await choose('Dark');
  expect(JSON.parse(await readFile(path.join(state.home, '.agentman/config.json'), 'utf8')).uiTheme).toBe('dark');

  // Desktop launches choose a new port and have no persistent browser storage.
  const next = await app();
  expect(new URL(next.url).origin).not.toBe(new URL(ui.url).origin);
  await page.goto(next.url);
  await expect(dark).toBeChecked();
  await expect(root).toHaveCSS('color-scheme', 'dark');

  // A failed save must restore both the selector and the actual palette.
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { name: 'ConflictError', message: 'Another operation is running', category: 'conflict' } }) });
  });
  await appearance.getByText('Light', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Another operation is running');
  await expect(dark).toBeChecked();
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  for (const viewport of [{ width: 1240, height: 880 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(appearance).toBeVisible();
    const selector = (await appearance.boundingBox())!;
    const quit = (await page.getByRole('button', { name: 'Quit Agent Manager', exact: true }).boundingBox())!;
    expect(selector.y + selector.height).toBeLessThan(quit.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});
