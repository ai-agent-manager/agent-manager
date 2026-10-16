import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFile(...args),
}));

vi.mock('../../../src/lib/platform.js', () => ({
  getPlatform: vi.fn(),
}));

const { openInBrowser } = await import('../../../src/auth/flow.js');
const { AuthFlowError } = await import('../../../src/auth/flow.js');
const { getPlatform } = await import('../../../src/lib/platform.js');
const mockGetPlatform = vi.mocked(getPlatform);

describe('openInBrowser', () => {
  beforeEach(() => {
    execFile.mockReset();
    mockGetPlatform.mockReset();
  });

  it('neutralizes a malicious authorization_endpoint instead of shelling out through cmd', () => {
    mockGetPlatform.mockReturnValue('windows');
    // Embedded quote that closed the `"${url}"` argument under the old
    // `cmd /c start` launcher, turning `& echo ... & rem "` into a separate
    // command. fetchOidcConfiguration only checks this is a nonempty string,
    // so a hostile IdP can return exactly this as authorization_endpoint.
    const hostileUrl =
      'https://idp.example.com/authorize" & echo PWNED> canary.txt & rem "?client_id=x&response_type=code';

    openInBrowser(hostileUrl);

    expect(execFile).toHaveBeenCalledTimes(1);
    const [command, args] = execFile.mock.calls[0];
    // Never invoke cmd.exe with the URL — that's the sink that let `&`
    // split into a second command.
    expect(command).not.toBe('cmd');
    expect(args).not.toContain('start');

    // The URL must travel as a single opaque PowerShell string literal, not
    // as text cmd.exe (or PowerShell itself) could re-parse.
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe(`Start-Process '${hostileUrl}'`);
  });

  it('rejects non-http(s) schemes', () => {
    mockGetPlatform.mockReturnValue('windows');

    expect(() => openInBrowser('file:///etc/passwd')).toThrow(AuthFlowError);
    expect(() => openInBrowser('javascript:alert(1)')).toThrow(AuthFlowError);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs', () => {
    mockGetPlatform.mockReturnValue('windows');

    expect(() => openInBrowser('not a url')).toThrow(AuthFlowError);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('launches a normal OAuth URL on Windows via PowerShell, never cmd', () => {
    mockGetPlatform.mockReturnValue('windows');
    const url =
      'https://idp.example.com/authorize?client_id=agentman-cli&response_type=code&scope=openid&state=abc123';

    openInBrowser(url);

    expect(execFile).toHaveBeenCalledTimes(1);
    const [command, args, options] = execFile.mock.calls[0];
    expect(command).toMatch(/powershell\.exe$/i);
    expect(command).not.toBe('cmd');
    expect(args).toContain('-EncodedCommand');
    expect(options).toMatchObject({ shell: false, windowsVerbatimArguments: true });

    // Decode the Base64 UTF-16LE payload and confirm the URL round-trips
    // intact as a single-quoted PowerShell literal, with no shell
    // re-interpretation of `&`.
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe(`Start-Process '${url}'`);
  });

  it('escapes an embedded single quote in the URL as a doubled PowerShell literal quote', () => {
    mockGetPlatform.mockReturnValue('windows');
    const url = "https://idp.example.com/authorize?x=don't";

    openInBrowser(url);

    const args = execFile.mock.calls[0][1] as string[];
    const encoded = args[args.indexOf('-EncodedCommand') + 1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    expect(decoded).toBe("Start-Process 'https://idp.example.com/authorize?x=don''t'");
  });

  it('opens URLs via `open` on macOS without a shell', () => {
    mockGetPlatform.mockReturnValue('macos');
    const url = 'https://idp.example.com/authorize?client_id=x';

    openInBrowser(url);

    expect(execFile).toHaveBeenCalledWith('open', [url], { shell: false });
  });

  it('opens URLs via `xdg-open` on Linux without a shell', () => {
    mockGetPlatform.mockReturnValue('linux');
    const url = 'https://idp.example.com/authorize?client_id=x';

    openInBrowser(url);

    expect(execFile).toHaveBeenCalledWith('xdg-open', [url], { shell: false });
  });
});
