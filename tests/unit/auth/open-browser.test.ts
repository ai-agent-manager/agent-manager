import { beforeEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { getPlatform } from '../../../src/lib/platform.js';
import { openInBrowser } from '../../../src/auth/flow.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../../src/lib/platform.js', async (original) => ({ ...await original<typeof import('../../../src/lib/platform.js')>(), getPlatform: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
it.each([
  ['macos', 'open'], ['linux', 'xdg-open'],
] as const)('opens a URL on %s without a shell', async (platform, command) => {
  vi.mocked(getPlatform).mockReturnValue(platform);
  vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _options: unknown, callback: (error: Error | null) => void) => { callback(null); }) as typeof execFile);
  const url = 'https://example.com/authorize?state=test&code_challenge=test';
  await openInBrowser(url);
  expect(execFile).toHaveBeenCalledWith(command, [url], { shell: false }, expect.any(Function));
});
it('resolves once the PowerShell launcher exits on Windows', async () => {
  // The Windows command construction itself is pinned by open-in-browser.test.ts.
  vi.mocked(getPlatform).mockReturnValue('windows');
  vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _options: unknown, callback: (error: Error | null) => void) => { callback(null); }) as typeof execFile);
  await openInBrowser('https://example.com/authorize?state=test');
  const [command, args, options] = vi.mocked(execFile).mock.calls[0] as unknown as [string, string[], object];
  expect(command).toMatch(/powershell\.exe$/i);
  expect(args).toContain('-EncodedCommand');
  expect(options).toMatchObject({ shell: false, windowsVerbatimArguments: true });
});
it('rejects a non-http(s) URL before spawning anything', async () => {
  vi.mocked(getPlatform).mockReturnValue('linux');
  await expect(Promise.resolve().then(() => openInBrowser('file:///etc/passwd'))).rejects.toThrow(/unsupported scheme/);
  expect(execFile).not.toHaveBeenCalled();
});
it('rejects when the platform launcher fails', async () => {
  vi.mocked(getPlatform).mockReturnValue('linux');
  vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _options: unknown, callback: (error: Error) => void) => { callback(new Error('No browser')); }) as typeof execFile);
  await expect(openInBrowser('https://example.com')).rejects.toThrow('No browser');
});
