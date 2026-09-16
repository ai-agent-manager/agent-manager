import { access } from 'node:fs/promises';
import { releaseOwnedLocks } from '../../src/lib/mutation.js';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runUiCommand } from '../../src/ui-command.js';
import { startUiServer } from '../../src/ui-server/index.js';
import { openInBrowser } from '../../src/auth/flow.js';

vi.mock('node:fs/promises', () => ({ access: vi.fn(async () => {}) }));
vi.mock('../../src/ui-server/index.js', () => ({ startUiServer: vi.fn() }));
vi.mock('../../src/auth/flow.js', () => ({ openInBrowser: vi.fn() }));
vi.mock('../../src/lib/mutation.js', () => ({ releaseOwnedLocks: vi.fn() }));
vi.mock('../../src/telemetry.js', () => ({ trackTelemetryEvent: vi.fn() }));
let events: EventEmitter;
let stop: ReturnType<typeof vi.fn>;
let previousExitCode: typeof process.exitCode;
let listeners: NodeJS.Signals[];
beforeEach(() => {
  vi.clearAllMocks(); previousExitCode = process.exitCode;
  events = new EventEmitter();
  stop = vi.fn(async () => { events.emit('close'); });
  vi.mocked(startUiServer).mockResolvedValue({ server: Object.assign(events, { closeAllConnections: vi.fn() }), port: 12345, token: 'test-token', url: 'http://127.0.0.1:12345/?token=test-token', stop } as unknown as Awaited<ReturnType<typeof startUiServer>>);
  vi.mocked(openInBrowser).mockResolvedValue();
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  listeners = ['SIGINT', 'SIGTERM'];
});
afterEach(() => { events.emit('close'); process.exitCode = previousExitCode; vi.restoreAllMocks(); });

it('prints the bootstrap URL and respects --no-open', async () => {
  await runUiCommand({ open: false, port: 0, portExplicit: true });
  expect(startUiServer).toHaveBeenCalledWith(expect.objectContaining({ port: 0 }));
  expect(console.log).toHaveBeenCalledWith('Web UI: http://127.0.0.1:12345/?token=test-token');
  expect(openInBrowser).not.toHaveBeenCalled();
});
it('falls back only when the default port is occupied', async () => {
  vi.mocked(startUiServer).mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
  await runUiCommand();
  expect(startUiServer).toHaveBeenNthCalledWith(2, expect.objectContaining({ port: 0 }));
  expect(openInBrowser).toHaveBeenCalledOnce();
});
it('does not silently replace an explicitly selected occupied port', async () => {
  const counts = listeners.map((signal) => process.listenerCount(signal));
  vi.mocked(startUiServer).mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EADDRINUSE' }));
  await expect(runUiCommand({ port: 19877, portExplicit: true })).rejects.toThrow('already in use');
  expect(startUiServer).toHaveBeenCalledOnce();
  expect(listeners.map((signal) => process.listenerCount(signal))).toEqual(counts);
});
it('reports browser launch failure while leaving the server available', async () => {
  vi.mocked(openInBrowser).mockRejectedValueOnce(new Error('no desktop'));
  await runUiCommand();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Open the Web UI URL above'));
  expect(stop).not.toHaveBeenCalled();
});
it('awaits server draining on signals and removes its handlers after close', async () => {
  const counts = listeners.map((signal) => process.listenerCount(signal));
  let release!: () => void;
  const drain = new Promise<void>((resolve) => { release = resolve; });
  stop.mockImplementation(async () => { await drain; events.emit('close'); });
  await runUiCommand({ open: false });
  // Call only the listener installed by this command, without delivering a
  // process signal to the test runner's own handlers.
  const onSignal = process.listeners('SIGINT').at(-1)!;
  onSignal('SIGINT');
  expect(stop).toHaveBeenCalledOnce();
  expect(process.exitCode).toBe(previousExitCode);
  release(); await vi.waitFor(() => expect(process.exitCode).toBe(0));
  expect(listeners.map((signal) => process.listenerCount(signal))).toEqual(counts);
});

it('a second signal forces exit and releases owned locks during a stalled drain', async () => {
  stop.mockImplementation(() => new Promise(() => {}));
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('forced exit'); });
  await runUiCommand({ open: false });
  const signal = process.listeners('SIGINT').at(-1)!;
  signal('SIGINT');
  expect(() => signal('SIGINT')).toThrow('forced exit');
  expect(exit).toHaveBeenCalledWith(130);
  expect(releaseOwnedLocks).toHaveBeenCalledOnce();
  expect((events as EventEmitter & { closeAllConnections: unknown }).closeAllConnections).toHaveBeenCalledOnce();
});
it('fails before starting a server or browser when web assets are missing', async () => {
  vi.mocked(access).mockRejectedValueOnce(new Error('missing'));
  await expect(runUiCommand()).rejects.toThrow('npm run build:web-ui');
  expect(startUiServer).not.toHaveBeenCalled();
  expect(openInBrowser).not.toHaveBeenCalled();
});
