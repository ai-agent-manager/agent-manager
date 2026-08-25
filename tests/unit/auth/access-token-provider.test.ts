import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

vi.mock('../../../src/auth/flow.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/auth/flow.js')>(
    '../../../src/auth/flow.js',
  );
  return { ...actual, authenticate: vi.fn() };
});

const { createDiscoveryAccessTokenProvider } = await import(
  '../../../src/auth/access-token-provider.js'
);
const { authenticate } = await import('../../../src/auth/flow.js');

const DOCUMENT: DiscoveryDocument = {
  version: '1',
  auth: {
    required: true,
    oidcDiscoveryUrl: 'https://identity.example.com/.well-known/openid-configuration',
    clientId: 'agentman',
  },
  sources: [
    { name: 'zip', type: 'artefact', url: 'https://cdn.example.com/skills/tool.zip' },
  ],
};

const CONTEXT = { baseUrl: 'https://discovery.example.com', document: DOCUMENT };

function interactiveOptions() {
  return { onAuthPrompt: vi.fn(), signal: new AbortController().signal };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ bearerToken: 'discovery-token', fromCache: true });
});

describe('createDiscoveryAccessTokenProvider', () => {
  it('authenticates at the request boundary for an eligible protected URL', async () => {
    const provider = createDiscoveryAccessTokenProvider(CONTEXT);
    const options = interactiveOptions();

    await expect(
      provider('https://cdn.example.com/skills/tool.zip', options),
    ).resolves.toBe('discovery-token');
    expect(authenticate).toHaveBeenCalledWith(
      'https://discovery.example.com',
      DOCUMENT.auth,
      options.onAuthPrompt,
      {
        signal: options.signal,
        interactiveMode: true,
        requestUrl: 'https://cdn.example.com/skills/tool.zip',
      },
    );
  });

  it('checks origin eligibility before authenticating: a foreign URL never prompts', async () => {
    const provider = createDiscoveryAccessTokenProvider(CONTEXT);

    await expect(
      provider('https://unlisted.example.com/tool.zip', interactiveOptions()),
    ).resolves.toBeUndefined();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns undefined without authenticating when there is no discovery context', async () => {
    const provider = createDiscoveryAccessTokenProvider(null);

    await expect(
      provider('https://cdn.example.com/skills/tool.zip', interactiveOptions()),
    ).resolves.toBeUndefined();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('returns undefined when the discovery document does not require auth', async () => {
    const provider = createDiscoveryAccessTokenProvider({
      baseUrl: CONTEXT.baseUrl,
      document: { ...DOCUMENT, auth: undefined },
    });

    await expect(
      provider('https://cdn.example.com/skills/tool.zip', interactiveOptions()),
    ).resolves.toBeUndefined();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('re-validates per request instead of replaying a snapshot (a later Update gets a fresh token)', async () => {
    const provider = createDiscoveryAccessTokenProvider(CONTEXT);
    vi.mocked(authenticate)
      .mockResolvedValueOnce({ bearerToken: 'first-token', fromCache: true })
      .mockResolvedValueOnce({ bearerToken: 'refreshed-token', fromCache: false, backend: 'keychain' });

    await expect(
      provider('https://cdn.example.com/skills/tool.zip', interactiveOptions()),
    ).resolves.toBe('first-token');
    await expect(
      provider('https://cdn.example.com/skills/tool.zip', interactiveOptions()),
    ).resolves.toBe('refreshed-token');
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation from authenticate', async () => {
    const provider = createDiscoveryAccessTokenProvider(CONTEXT);
    vi.mocked(authenticate).mockRejectedValue(new Error('Authentication cancelled'));

    await expect(
      provider('https://cdn.example.com/skills/tool.zip', interactiveOptions()),
    ).rejects.toThrow('Authentication cancelled');
  });
});
