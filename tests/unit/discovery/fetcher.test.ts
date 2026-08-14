import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { fetchDiscoveryDocument, DiscoveryError } = await import(
  '../../../src/discovery/fetcher.js'
);

const validDocument: DiscoveryDocument = {
  version: '1',
  sources: [
    {
      name: 'test-skill',
      type: 'git',
      url: 'https://github.com/example/test.git',
      status: 'official',
    },
  ],
};

const validDocumentWithAuth: DiscoveryDocument = {
  version: '1',
  auth: {
    required: true,
    oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
    clientId: 'test-client',
    scopes: ['openid'],
  },
  telemetry: {
    url: 'https://telemetry.example.com',
    siteId: 'test-site',
  },
  sources: [
    {
      name: 'protected-skill',
      type: 'http',
      url: 'https://skills.example.com/bundle',
    },
  ],
};

describe('fetchDiscoveryDocument', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches and returns a valid discovery document', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDocument,
    });

    const result = await fetchDiscoveryDocument('https://example.com');
    expect(result).toEqual(validDocument);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/agents/discovery.json',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
  });

  it('passes Bearer token when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDocument,
    });

    await fetchDiscoveryDocument('https://example.com', 'my-token');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-token',
        }),
      }),
    );
  });

  it('returns a document with auth configuration', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDocumentWithAuth,
    });

    const result = await fetchDiscoveryDocument('https://example.com');
    expect(result.auth?.required).toBe(true);
    expect(result.auth?.oidcDiscoveryUrl).toBe(
      'https://auth.example.com/.well-known/openid-configuration',
    );
    expect(result.telemetry?.url).toBe('https://telemetry.example.com');
    expect(result.telemetry?.siteId).toBe('test-site');
  });

  it('accepts an HTTP source with an explicit exact indexUrl', async () => {
    const document: DiscoveryDocument = {
      version: '1',
      sources: [{
        name: 'team-a',
        type: 'http',
        indexUrl: 'https://skills.example.com/catalogues/team-a/index.json',
      }],
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => document });

    await expect(fetchDiscoveryDocument('https://example.com')).resolves.toEqual(document);
  });

  it.each([
    {
      name: 'both url and indexUrl',
      source: {
        name: 'invalid',
        type: 'http',
        url: 'https://skills.example.com',
        indexUrl: 'https://skills.example.com/catalogues/team-a/index.json',
      },
    },
    {
      name: 'neither url nor indexUrl',
      source: { name: 'invalid', type: 'http' },
    },
    {
      name: 'indexUrl does not point to index.json',
      source: {
        name: 'invalid',
        type: 'http',
        indexUrl: 'https://skills.example.com/catalogues/team-a/catalogue.json',
      },
    },
    {
      name: 'indexUrl is not HTTP',
      source: { name: 'invalid', type: 'http', indexUrl: 'file:///tmp/index.json' },
    },
  ])('rejects an HTTP source with $name', async ({ source }) => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1', sources: [source] }),
    });

    await expect(fetchDiscoveryDocument('https://example.com')).rejects.toThrow(
      'Discovery document validation failed',
    );
  });

  it('throws DiscoveryError on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      fetchDiscoveryDocument('https://example.com'),
    ).rejects.toThrow(DiscoveryError);
  });

  it('throws DiscoveryError on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(
      fetchDiscoveryDocument('https://example.com'),
    ).rejects.toThrow('Discovery document not found');
  });

  it('throws DiscoveryError on invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    });

    await expect(
      fetchDiscoveryDocument('https://example.com'),
    ).rejects.toThrow('not valid JSON');
  });

  it('throws DiscoveryError on schema validation failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '99', sources: 'not-an-array' }),
    });

    await expect(
      fetchDiscoveryDocument('https://example.com'),
    ).rejects.toThrow('validation failed');
  });

  it('throws DiscoveryError when skills array is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '1' }),
    });

    await expect(
      fetchDiscoveryDocument('https://example.com'),
    ).rejects.toThrow('validation failed');
  });

  it('constructs correct well-known URL from base with trailing slash', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validDocument,
    });

    await fetchDiscoveryDocument('https://example.com/');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/.well-known/agents/discovery.json',
      expect.any(Object),
    );
  });
});

describe('DiscoveryError', () => {
  it('includes baseUrl property', () => {
    const err = new DiscoveryError('test', 'https://example.com');
    expect(err.baseUrl).toBe('https://example.com');
    expect(err.name).toBe('DiscoveryError');
  });

  it('includes cause when provided', () => {
    const cause = new Error('root cause');
    const err = new DiscoveryError('test', 'https://example.com', cause);
    expect(err.cause).toBe(cause);
  });
});
