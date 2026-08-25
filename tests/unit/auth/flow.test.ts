import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AGENTMAN_ACCESS_TOKEN_ENV, AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV } from '../../../src/auth/env-token.js';

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

const { getValidBearerToken, authenticate, AuthFlowError, AuthCancelledError } = await import(
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

describe('AGENTMAN_ACCESS_TOKEN', () => {
  const previousToken = process.env[AGENTMAN_ACCESS_TOKEN_ENV];
  const previousHosts = process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV];

  beforeEach(() => {
    loadTokens.mockReset();
    isTokenExpired.mockReset();
    fetchOidcConfiguration.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    if (previousToken === undefined) {
      delete process.env[AGENTMAN_ACCESS_TOKEN_ENV];
    } else {
      process.env[AGENTMAN_ACCESS_TOKEN_ENV] = previousToken;
    }
    if (previousHosts === undefined) {
      delete process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV];
    } else {
      process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV] = previousHosts;
    }
  });

  it('returns AGENTMAN_ACCESS_TOKEN from authenticate without requiring OIDC config', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';
    const onPrompt = vi.fn();

    const result = await authenticate(baseUrl, { required: true }, onPrompt);

    expect(result).toEqual({
      bearerToken: 'env-bearer-token',
      fromCache: true,
      fromEnv: true,
    });
    expect(onPrompt).not.toHaveBeenCalled();
    expect(loadTokens).not.toHaveBeenCalled();
  });

  it('returns AGENTMAN_ACCESS_TOKEN from getValidBearerToken without store lookup', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';

    const token = await getValidBearerToken(baseUrl, auth);

    expect(token).toBe('env-bearer-token');
    expect(loadTokens).not.toHaveBeenCalled();
  });

  it('prefers AGENTMAN_ACCESS_TOKEN over a cached token', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-wins';
    loadTokens.mockResolvedValueOnce({
      bearerToken: 'cached-token',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      oidcDiscoveryUrl: auth.oidcDiscoveryUrl,
      clientId: auth.clientId,
    });
    isTokenExpired.mockReturnValueOnce(false);

    const result = await authenticate(baseUrl, auth, () => {
      throw new Error('onPrompt should not be called');
    });

    expect(result.bearerToken).toBe('env-wins');
    expect(result.fromEnv).toBe(true);
    expect(loadTokens).not.toHaveBeenCalled();
  });

  it('trims AGENTMAN_ACCESS_TOKEN before using it', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = '  padded-token  ';

    const result = await authenticate(baseUrl, { required: true }, () => {
      throw new Error('onPrompt should not be called');
    });

    expect(result.bearerToken).toBe('padded-token');
    expect(result.fromEnv).toBe(true);
  });

  it('requires AGENTMAN_INTERACTIVE_TOKEN_HOSTS in interactive mode', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';

    await expect(
      authenticate(baseUrl, { required: true }, () => {}, { interactiveMode: true }),
    ).rejects.toThrow(/AGENTMAN_INTERACTIVE_TOKEN_HOSTS/i);
  });

  it('uses AGENTMAN_ACCESS_TOKEN in interactive mode when the host is allowlisted', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';
    process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV] = 'discovery.example.com';

    const result = await authenticate(baseUrl, { required: true }, () => {}, {
      interactiveMode: true,
    });

    expect(result).toEqual({
      bearerToken: 'env-bearer-token',
      fromCache: true,
      fromEnv: true,
    });
  });

  it('refuses AGENTMAN_ACCESS_TOKEN in interactive mode for a non-allowlisted host', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';
    process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV] = 'other.example.com';

    await expect(
      authenticate(baseUrl, { required: true }, () => {}, { interactiveMode: true }),
    ).rejects.toThrow(/not listed in AGENTMAN_INTERACTIVE_TOKEN_HOSTS/i);
  });

  it('checks requestUrl against the allowlist in interactive mode', async () => {
    process.env[AGENTMAN_ACCESS_TOKEN_ENV] = 'env-bearer-token';
    process.env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV] = 'cdn.example.com';

    await expect(
      getValidBearerToken(baseUrl, auth, {
        interactiveMode: true,
        requestUrl: 'https://cdn.example.com/skills.zip',
      }),
    ).resolves.toBe('env-bearer-token');

    await expect(
      getValidBearerToken(baseUrl, auth, {
        interactiveMode: true,
        requestUrl: 'https://discovery.example.com',
      }),
    ).rejects.toThrow(/not listed in AGENTMAN_INTERACTIVE_TOKEN_HOSTS/i);
  });
});
