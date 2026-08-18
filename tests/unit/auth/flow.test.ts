import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DiscoveryAuth } from '../../../src/discovery/types.js';

vi.mock('../../../src/auth/token-store.js', () => ({
  loadTokens: vi.fn(),
  saveTokens: vi.fn(async () => 'keychain'),
  isTokenExpired: vi.fn(),
}));

vi.mock('../../../src/auth/callback-server.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/auth/callback-server.js')>(
    '../../../src/auth/callback-server.js',
  );
  return { ...actual, waitForCallback: vi.fn() };
});

const { authenticate, AuthCancelledError } = await import('../../../src/auth/flow.js');
const { loadTokens, isTokenExpired } = await import('../../../src/auth/token-store.js');
const { waitForCallback } = await import('../../../src/auth/callback-server.js');

const AUTH: DiscoveryAuth = {
  required: true,
  oidcDiscoveryUrl: 'https://identity.example.com/.well-known/openid-configuration',
  clientId: 'agentman',
};

const OIDC_DOCUMENT = {
  issuer: 'https://identity.example.com',
  authorization_endpoint: 'https://identity.example.com/authorize',
  token_endpoint: 'https://identity.example.com/token',
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authenticate cancellation', () => {
  it('returns a valid cached token without any network traffic', async () => {
    vi.mocked(loadTokens).mockResolvedValue({
      bearerToken: 'cached-token',
      oidcDiscoveryUrl: AUTH.oidcDiscoveryUrl!,
      clientId: AUTH.clientId!,
    });
    vi.mocked(isTokenExpired).mockReturnValue(false);

    const result = await authenticate('https://discovery.example.com', AUTH, () => {});

    expect(result).toEqual({ bearerToken: 'cached-token', fromCache: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitForCallback).not.toHaveBeenCalled();
  });

  it('throws AuthCancelledError up front when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      authenticate('https://discovery.example.com', AUTH, () => {}, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AuthCancelledError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes a refresh aborted mid-flight and never falls through to interactive login', async () => {
    const controller = new AbortController();
    vi.mocked(loadTokens).mockResolvedValue({
      bearerToken: 'expired-token',
      refreshToken: 'refresh-token',
      oidcDiscoveryUrl: AUTH.oidcDiscoveryUrl!,
      clientId: AUTH.clientId!,
    });
    vi.mocked(isTokenExpired).mockReturnValue(true);

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('openid-configuration')) {
        return new Response(JSON.stringify(OIDC_DOCUMENT), { status: 200 });
      }
      // The refresh POST: abort mid-flight, as Escape during a refresh would.
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    await expect(
      authenticate('https://discovery.example.com', AUTH, () => {}, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('Authentication cancelled');

    // The cancelled refresh must not have started an interactive login.
    expect(waitForCallback).not.toHaveBeenCalled();
  });

  it('normalizes an aborted callback wait to Authentication cancelled', async () => {
    const controller = new AbortController();
    vi.mocked(loadTokens).mockResolvedValue(null);

    fetchMock.mockResolvedValue(new Response(JSON.stringify(OIDC_DOCUMENT), { status: 200 }));
    vi.mocked(waitForCallback).mockImplementation(async () => {
      controller.abort();
      throw new Error('Timed out waiting for authorization callback');
    });

    const onPrompt = vi.fn();
    await expect(
      authenticate('https://discovery.example.com', AUTH, onPrompt, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AuthCancelledError);
    expect(onPrompt).toHaveBeenCalledWith(expect.stringContaining('https://identity.example.com/authorize'));
  });
});
