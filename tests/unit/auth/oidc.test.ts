import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { fetchOidcConfiguration, OidcDiscoveryError } = await import(
  '../../../src/auth/oidc.js'
);

const validConfig = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  scopes_supported: ['openid', 'profile'],
};

describe('fetchOidcConfiguration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches and returns a valid OIDC configuration', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validConfig,
    });

    const result = await fetchOidcConfiguration(
      'https://auth.example.com/.well-known/openid-configuration',
    );
    expect(result.issuer).toBe('https://auth.example.com');
    expect(result.authorization_endpoint).toBe('https://auth.example.com/authorize');
    expect(result.token_endpoint).toBe('https://auth.example.com/token');
  });

  it('throws OidcDiscoveryError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow(OidcDiscoveryError);
  });

  it('throws OidcDiscoveryError on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow('HTTP 500');
  });

  it('throws OidcDiscoveryError when issuer is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
      }),
    });

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow("missing required field 'issuer'");
  });

  it('throws OidcDiscoveryError when token_endpoint is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
      }),
    });

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow("missing required field 'token_endpoint'");
  });

  it('throws OidcDiscoveryError when response is not a JSON object', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => 'not-an-object',
    });

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow('not a JSON object');
  });

  it('throws OidcDiscoveryError on invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected'); },
    });

    await expect(
      fetchOidcConfiguration('https://auth.example.com/.well-known/openid-configuration'),
    ).rejects.toThrow('not valid JSON');
  });
});
