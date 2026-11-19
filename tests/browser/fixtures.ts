import { assertCallbackPortAvailable, boundedServer } from '../support/lifecycle.js';
import { test as base, expect } from 'playwright/test';
import { sandbox } from '../support/sandbox.js';
import { startUiServer, type UiServerOptions } from '../../src/ui-server/index.js';
import { _disableKeychain } from '../../src/auth/token-store.js';

export const test = base.extend<{
  state: Awaited<ReturnType<typeof sandbox>>;
  oauthPort: void;
  cleanup: (release: () => Promise<void>) => void;
  app: (options?: UiServerOptions) => Promise<Awaited<ReturnType<typeof startUiServer>>>;
}>({
  // Playwright reads this destructuring pattern to discover fixture dependencies.
  // oxlint-disable-next-line no-empty-pattern
  state: [async ({}, use) => {
    const state = await sandbox(); _disableKeychain();
    try { await use(state); } finally { await state.close(); }
  }, { timeout: 15_000 }],
  // oxlint-disable-next-line no-empty-pattern
  oauthPort: async ({}, use) => { await assertCallbackPortAvailable(); await use(); },
  cleanup: [async ({ state }, use) => {
    void state; // Restore HOME only after all owned resources have been released.
    const releases: Array<() => Promise<void>> = [];
    try { await use((release) => releases.push(release)); }
    finally { await releaseResources(releases); }
  }, { timeout: 15_000 }],
  app: async ({ state, cleanup }, use) => {
    await use(async (options = {}) => {
      const server = boundedServer(await startUiServer({ port: 0, cwd: state.repo, startupSource: state.source, ...options }));
      cleanup(() => server.stop());
      return server;
    });
  },
});
export { expect };

async function releaseResources(releases: Array<() => Promise<void>>) {
  const errors: unknown[] = [];
  // Release the application before the provider/listener it was created with.
  // Fixture failures are reported separately from the primary test assertion.
  for (const release of releases.reverse()) {
    try { await release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Test resource teardown failed');
}
