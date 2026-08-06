import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthSession } from '../../../src/auth/index.js';

const getValidBearerToken = vi.fn();

vi.mock('../../../src/auth/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/auth/index.js')>(
    '../../../src/auth/index.js',
  );
  return {
    ...actual,
    getValidBearerToken: (...args: unknown[]) => getValidBearerToken(...args),
  };
});

const {
  apiRequest,
  normaliseApiBaseUrl,
  resolveApiBaseUrl,
  isProjectsFeatureEnabled,
  canAccessMyProjects,
  ApiError,
} = await import('../../../src/api/client.js');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const authSession: AuthSession = {
  discoveryBaseUrl: 'https://discovery.example.com',
  auth: {
    required: true,
    oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    clientId: 'agentman-cli',
  },
};

describe('normaliseApiBaseUrl', () => {
  it('strips a single trailing slash', () => {
    expect(normaliseApiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('strips multiple trailing slashes', () => {
    expect(normaliseApiBaseUrl('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('leaves a URL without a trailing slash unchanged', () => {
    expect(normaliseApiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
  });
});

describe('resolveApiBaseUrl', () => {
  it('prefers API_BASE_URL over the discovery value', () => {
    expect(
      resolveApiBaseUrl('https://discovery.example.com/api', {
        API_BASE_URL: 'https://env.example.com/api/',
      }),
    ).toBe('https://env.example.com/api');
  });

  it('falls back to discovery.api.baseUrl when the env var is unset', () => {
    expect(
      resolveApiBaseUrl('https://discovery.example.com/api/', {}),
    ).toBe('https://discovery.example.com/api');
  });

  it('ignores blank API_BASE_URL values', () => {
    expect(
      resolveApiBaseUrl('https://discovery.example.com/api', {
        API_BASE_URL: '   ',
      }),
    ).toBe('https://discovery.example.com/api');
  });

  it('returns undefined when neither source provides a URL', () => {
    expect(resolveApiBaseUrl(undefined, {})).toBeUndefined();
  });

  it('uses API_BASE_URL alone when discovery omits api.baseUrl', () => {
    expect(
      resolveApiBaseUrl(undefined, { API_BASE_URL: 'https://env.example.com' }),
    ).toBe('https://env.example.com');
  });
});

describe('isProjectsFeatureEnabled', () => {
  it('is true only when projects is explicitly true', () => {
    expect(isProjectsFeatureEnabled({ projects: true })).toBe(true);
    expect(isProjectsFeatureEnabled({ projects: false })).toBe(false);
    expect(isProjectsFeatureEnabled({})).toBe(false);
    expect(isProjectsFeatureEnabled(undefined)).toBe(false);
  });
});

describe('canAccessMyProjects', () => {
  const ready = {
    authRequired: true,
    features: { projects: true },
    apiBaseUrl: 'https://api.example.com',
    authSession,
  };

  it('is true when auth, feature flag, API URL, and session are all present', () => {
    expect(canAccessMyProjects(ready)).toBe(true);
  });

  it('is false when the projects feature is disabled', () => {
    expect(canAccessMyProjects({ ...ready, features: { projects: false } })).toBe(false);
    expect(canAccessMyProjects({ ...ready, features: undefined })).toBe(false);
  });

  it('is false when auth is not required or missing', () => {
    expect(canAccessMyProjects({ ...ready, authRequired: false })).toBe(false);
    expect(canAccessMyProjects({ ...ready, authRequired: undefined })).toBe(false);
  });

  it('is false when the API base URL or auth session is missing', () => {
    expect(canAccessMyProjects({ ...ready, apiBaseUrl: undefined })).toBe(false);
    expect(canAccessMyProjects({ ...ready, authSession: null })).toBe(false);
    expect(canAccessMyProjects({ ...ready, authSession: undefined })).toBe(false);
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    getValidBearerToken.mockReset();
    getValidBearerToken.mockResolvedValue('token-123');
  });

  it('resolves a bearer token before fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiRequest('https://api.example.com/', '/projects', authSession);

    expect(getValidBearerToken).toHaveBeenCalledWith(
      authSession.discoveryBaseUrl,
      authSession.auth,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('prepends a slash when the path omits one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    await apiRequest('https://api.example.com', 'projects', authSession);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/projects',
      expect.any(Object),
    );
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: 'p1' }],
    });

    const result = await apiRequest<{ id: string }[]>(
      'https://api.example.com',
      '/projects',
      authSession,
    );
    expect(result).toEqual([{ id: 'p1' }]);
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await apiRequest<void>(
      'https://api.example.com',
      '/projects/x',
      authSession,
      { method: 'DELETE' },
    );
    expect(result).toBeUndefined();
  });

  it('force-refreshes once and retries on HTTP 401', async () => {
    getValidBearerToken
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorised',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 'p1' }],
      });

    const result = await apiRequest<{ id: string }[]>(
      'https://api.example.com',
      '/projects',
      authSession,
    );

    expect(result).toEqual([{ id: 'p1' }]);
    expect(getValidBearerToken).toHaveBeenNthCalledWith(
      1,
      authSession.discoveryBaseUrl,
      authSession.auth,
    );
    expect(getValidBearerToken).toHaveBeenNthCalledWith(
      2,
      authSession.discoveryBaseUrl,
      authSession.auth,
      { forceRefresh: true },
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fresh-token',
        }),
      }),
    );
  });

  it('throws ApiError on non-OK response that is not a recoverable 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    await expect(
      apiRequest('https://api.example.com', '/projects', authSession),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      body: 'boom',
    });
  });

  it('throws ApiError when the 401 retry also fails', async () => {
    getValidBearerToken
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('still-bad');
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorised',
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Still unauthorised',
      });

    await expect(
      apiRequest('https://api.example.com', '/projects', authSession),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      body: 'Still unauthorised',
    });
  });

  it('throws ApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      apiRequest('https://api.example.com', '/projects', authSession),
    ).rejects.toThrow(ApiError);
  });
});
