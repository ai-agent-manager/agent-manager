import { afterEach, expect, it, vi } from 'vitest';
import { waitForPublishedVersion } from '../src/published-version.js';
afterEach(() => vi.useRealTimers());
it('waits through propagation failures and a stale registry response for the exact release', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockRejectedValueOnce(new Error('temporary connection failure'))
    .mockResolvedValueOnce(Response.json({ version: '0.22.0' }))
    .mockResolvedValueOnce(Response.json({ version: '0.23.0' }));
  const wait = waitForPublishedVersion('0.23.0', { fetchImpl, timeoutMs: 1000, intervalMs: 100 });
  await vi.runAllTimersAsync(); await wait;
  expect(fetchImpl).toHaveBeenCalledTimes(4);
});
it('fails within the configured deadline with a release-specific remedy', async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 404 }));
  const rejected = expect(waitForPublishedVersion('0.23.0', { fetchImpl, timeoutMs: 250, intervalMs: 100 }))
    .rejects.toThrow('CLI 0.23.0 is not available');
  await vi.runAllTimersAsync(); await rejected;
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
