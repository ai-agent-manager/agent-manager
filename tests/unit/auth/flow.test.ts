import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadTokens = vi.fn();
const saveTokens = vi.fn();
const isTokenExpired = vi.fn();
const fetchOidcConfiguration = vi.fn();

vi.mock('../../../src/auth/token-store.js', () => ({
  loadTokens: (...args: unknown[]) => loadTokens(...args),
  saveTokens: (...args: unknown[]) => saveTokens(...args),
  isTokenExpired: (...args: unknown[]) => isTokenExpired(...args),
}));

vi.mock('../../../src/auth/oidc.js', () => ({
  fetchOidcConfiguration: (...args: unknown[]) => fetchOidcConfiguration(...args),
  OidcDiscoveryError: class OidcDiscoveryError extends Error {},
}));

vi.mock('../../../src/auth/callback-server.js', () => ({
  waitForCallback: vi.fn(),
  REDIRECT_URI: 'http://127.0.0.1:9876/callback',
  OAUTH_CALLBACK_PORT: 9876,
  CallbackServerError: class CallbackServerError extends Error {},
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { getValidBearerToken, authenticate, bearerOptionsFromSession, AuthFlowError, AuthCancelledError } = await import(
  '../../../src/auth/flow.js'
);
const { waitForCallback } = await import('../../../src/auth/callback-server.js');

const baseUrl = 'https://discovery.example.com';
const auth = {
  required: true,
  oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
  clientId: 'agentman-cli',
};

const oidcConfig = {
  authorization_endpoint: 'https://idp.example.com/authorize',
  token_endpoint: 'https://idp.example.com/token',
  issuer: 'https://idp.example.com',
};

describe('getValidBearerToken', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    loadTokens.mockReset();
    saveTokens.mockReset();
    isTokenExpired.mockReset();
    fetchOidcConfiguration.mockReset();
    mockFetch.mockReset();
    fetchOidcConfiguration.mockResolvedValue(oidcConfig);
    saveTokens.mockResolvedValue('filesystem');
  });

  it('returns a cached bearer when the token is still valid', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'cached-bearer',
      refreshToken: 'refresh',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(false);

    const token = await getValidBearerToken(baseUrl, auth);

    expect(token).toBe('cached-bearer');
    expect(fetchOidcConfiguration).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes an expired token when a refresh token is present', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'stale-bearer',
      refreshToken: 'refresh-me',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        id_token: 'new-id',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const token = await getValidBearerToken(baseUrl, auth);

    expect(token).toBe('new-id');
    expect(mockFetch).toHaveBeenCalledWith(
      oidcConfig.token_endpoint,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(saveTokens).toHaveBeenCalledWith(
      baseUrl,
      expect.objectContaining({
        bearerToken: 'new-id',
        refreshToken: 'refresh-me',
      }),
    );
  });

  it('throws when refresh fails and interactive login is not allowed', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'stale-bearer',
      refreshToken: 'refresh-me',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(getValidBearerToken(baseUrl, auth)).rejects.toThrow(AuthFlowError);
  });

  it('forceRefresh skips the valid-cache short-circuit', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'still-valid',
      refreshToken: 'refresh-me',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(false);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'forced-access',
        id_token: 'forced-id',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const token = await getValidBearerToken(baseUrl, auth, { forceRefresh: true });

    expect(token).toBe('forced-id');
    expect(isTokenExpired).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
  });

  it('throws when no cached tokens exist and interactive login is not allowed', async () => {
    loadTokens.mockResolvedValueOnce(null);

    await expect(getValidBearerToken(baseUrl, auth)).rejects.toThrow(
      /no valid token is available/i,
    );
  });

  it('throws when the token is expired and no refresh token is available', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'stale-bearer',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(true);

    await expect(getValidBearerToken(baseUrl, auth)).rejects.toThrow(AuthFlowError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when discovery auth is missing OIDC configuration', async () => {
    await expect(
      getValidBearerToken(baseUrl, { required: true }),
    ).rejects.toThrow(/missing oidcDiscoveryUrl or clientId/i);
  });

  it('falls back to access_token when the refresh response omits id_token', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'stale-bearer',
      refreshToken: 'refresh-me',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(true);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'access-only',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });

    const token = await getValidBearerToken(baseUrl, auth);

    expect(token).toBe('access-only');
    expect(saveTokens).toHaveBeenCalledWith(
      baseUrl,
      expect.objectContaining({ bearerToken: 'access-only' }),
    );
  });
});

describe('authenticate', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    loadTokens.mockReset();
    isTokenExpired.mockReset();
    fetchOidcConfiguration.mockReset();
    mockFetch.mockReset();
  });

  it('returns cached tokens without prompting when still valid', async () => {
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'cached-bearer',
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(false);
    const onPrompt = vi.fn();

    const result = await authenticate(baseUrl, auth, onPrompt);

    expect(result).toEqual({ bearerToken: 'cached-bearer', fromCache: true });
    expect(onPrompt).not.toHaveBeenCalled();
  });
});

describe('authenticate cancellation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    loadTokens.mockReset();
    saveTokens.mockReset();
    isTokenExpired.mockReset();
    fetchOidcConfiguration.mockReset();
    mockFetch.mockReset();
    fetchOidcConfiguration.mockResolvedValue(oidcConfig);
    saveTokens.mockResolvedValue('filesystem');
  });

  it('throws AuthCancelledError up front when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      authenticate(baseUrl, auth, () => {}, {
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AuthCancelledError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('normalizes a refresh aborted mid-flight and never falls through to interactive login', async () => {
    const controller = new AbortController();
    loadTokens.mockResolvedValue({
      bearerToken: 'expired-token',
      refreshToken: 'refresh-token',
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValue(true);

    mockFetch.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    await expect(
      authenticate(baseUrl, auth, () => {}, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('Authentication cancelled');

    expect(waitForCallback).not.toHaveBeenCalled();
  });
});

describe('bearerOptionsFromSession', () => {
  const session = {
    discoveryBaseUrl: baseUrl,
    auth,
  };

  it('always includes requestUrl', () => {
    expect(bearerOptionsFromSession(session, 'https://cdn.example.com/x.zip')).toEqual({
      requestUrl: 'https://cdn.example.com/x.zip',
    });
  });

  it('forwards interactiveMode and forceRefresh when set', () => {
    expect(
      bearerOptionsFromSession(
        { ...session, interactiveMode: true },
        'https://api.example.com/projects',
        { forceRefresh: true },
      ),
    ).toEqual({
      requestUrl: 'https://api.example.com/projects',
      interactiveMode: true,
      forceRefresh: true,
    });
  });
});

describe('AGENTMAN_ACCESS_TOKEN', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    loadTokens.mockReset();
    fetchOidcConfiguration.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the env token without OIDC or store lookup in headless mode', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');

    const token = await getValidBearerToken(baseUrl, { required: true });

    expect(token).toBe('env-bearer');
    expect(loadTokens).not.toHaveBeenCalled();
    expect(fetchOidcConfiguration).not.toHaveBeenCalled();
  });

  it('overrides a cached OAuth token', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'cached-oauth',
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });

    const result = await authenticate(baseUrl, auth, vi.fn());

    expect(result).toEqual({ bearerToken: 'env-bearer', fromCache: true, fromEnv: true });
    expect(loadTokens).not.toHaveBeenCalled();
  });

  it('requires AGENTMAN_INTERACTIVE_TOKEN_HOSTS in interactive mode', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');

    await expect(
      authenticate(baseUrl, auth, vi.fn(), { interactiveMode: true, requestUrl: baseUrl }),
    ).rejects.toThrow(/AGENTMAN_INTERACTIVE_TOKEN_HOSTS is not/);
    expect(fetchOidcConfiguration).not.toHaveBeenCalled();
  });

  it('sends the env token to an allowlisted host in interactive mode', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');
    vi.stubEnv('AGENTMAN_INTERACTIVE_TOKEN_HOSTS', 'discovery.example.com,cdn.example.com');

    const result = await authenticate(baseUrl, { required: true }, vi.fn(), {
      interactiveMode: true,
      requestUrl: 'https://cdn.example.com/bundle.zip',
    });

    expect(result.fromEnv).toBe(true);
    expect(result.bearerToken).toBe('env-bearer');
  });

  it('refuses the env token for a host that is not allowlisted and does not fall through to OAuth', async () => {
    vi.stubEnv('AGENTMAN_ACCESS_TOKEN', 'env-bearer');
    vi.stubEnv('AGENTMAN_INTERACTIVE_TOKEN_HOSTS', 'discovery.example.com');
    const onPrompt = vi.fn();

    await expect(
      authenticate(baseUrl, auth, onPrompt, {
        interactiveMode: true,
        requestUrl: 'https://evil.example.com/bundle.zip',
      }),
    ).rejects.toThrow(/Refusing to send AGENTMAN_ACCESS_TOKEN to evil.example.com/);
    expect(onPrompt).not.toHaveBeenCalled();
    expect(loadTokens).not.toHaveBeenCalled();
  });
});
