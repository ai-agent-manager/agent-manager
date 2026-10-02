import { expect, it, vi } from 'vitest';
import { shutdownOnce } from '../src/lifecycle.js';
it('awaits startup and drain across repeated quit requests', async () => {
  let started!: (value: { stop(): Promise<void> }) => void, drained!: () => void;
  const startup = new Promise<{ stop(): Promise<void> }>((resolve) => { started = resolve; });
  const drain = new Promise<void>((resolve) => { drained = resolve; });
  const stop = vi.fn(() => drain), closed = vi.fn();
  const shutdown = shutdownOnce(startup, closed);
  const first = shutdown(); expect(shutdown()).toBe(first); expect(stop).not.toHaveBeenCalled();
  started({ stop }); await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce(); expect(closed).not.toHaveBeenCalled();
  drained(); await first; expect(closed).toHaveBeenCalledOnce();
});
it('does not report a successful quit after a failed drain', async () => {
  const closed = vi.fn();
  const shutdown = shutdownOnce(Promise.resolve({ stop: async () => { throw new Error('drain failed'); } }), closed);
  await expect(shutdown()).rejects.toThrow('drain failed'); expect(closed).not.toHaveBeenCalled();
});
