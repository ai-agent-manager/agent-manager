import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiRequest,
  normaliseApiBaseUrl,
  resolveApiBaseUrl,
  isProjectsFeatureEnabled,
  canAccessMyProjects,
  ApiError,
} from '../../../src/api/client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
    bearerToken: 'token',
  };

  it('is true when auth, feature flag, API URL, and token are all present', () => {
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

  it('is false when the API base URL or bearer token is missing', () => {
    expect(canAccessMyProjects({ ...ready, apiBaseUrl: undefined })).toBe(false);
    expect(canAccessMyProjects({ ...ready, bearerToken: null })).toBe(false);
    expect(canAccessMyProjects({ ...ready, bearerToken: undefined })).toBe(false);
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls the API with the normalised base URL and Bearer token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await apiRequest('https://api.example.com/', '/projects', 'token-123');

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

    await apiRequest('https://api.example.com', 'projects', 'token');

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
      'token',
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
      'token',
      { method: 'DELETE' },
    );
    expect(result).toBeUndefined();
  });

  it('throws ApiError on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorised',
    });

    await expect(
      apiRequest('https://api.example.com', '/projects', 'bad-token'),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      body: 'Unauthorised',
    });
  });

  it('throws ApiError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      apiRequest('https://api.example.com', '/projects', 'token'),
    ).rejects.toThrow(ApiError);
  });
});
