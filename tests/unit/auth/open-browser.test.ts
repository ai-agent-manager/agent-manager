import { beforeEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { getPlatform } from '../../../src/lib/platform.js';
import { openInBrowser } from '../../../src/auth/flow.js';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../../src/lib/platform.js', async (original) => ({ ...await original<typeof import('../../../src/lib/platform.js')>(), getPlatform: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); });
it.each([
  ['windows', 'rundll32', ['url.dll,FileProtocolHandler']], ['macos', 'open', []], ['linux', 'xdg-open', []],
] as const)('opens a URL on %s without a shell', async (platform, command, prefix) => {
  vi.mocked(getPlatform).mockReturnValue(platform);
  vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _options: unknown, callback: (error: Error | null) => void) => { callback(null); }) as typeof execFile);
  const url = 'https://example.com/authorize?state=test&code_challenge=test';
  await openInBrowser(url);
  expect(execFile).toHaveBeenCalledWith(command, [...prefix, url], { shell: false }, expect.any(Function));
});
it('rejects when the platform launcher fails', async () => {
  vi.mocked(getPlatform).mockReturnValue('linux');
  vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _options: unknown, callback: (error: Error) => void) => { callback(new Error('No browser')); }) as typeof execFile);
  await expect(openInBrowser('https://example.com')).rejects.toThrow('No browser');
});
