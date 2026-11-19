import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, bootstrapToken } from './client.js';

describe('token bootstrap', () => {
  const code = '12345678-1234-4234-8234-123456789abc', bearer = 'abcdefab-abcd-4bcd-8bcd-abcdefabcdef';
  const exchange = (status = 200) => vi.fn(async (_path: RequestInfo | URL, options?: RequestInit) => {
    expect(JSON.parse(String(options?.body))).toEqual({ code });
    return new Response(JSON.stringify(status === 200 ? { token: bearer } : { error: { name: 'LaunchRejected', message: 'spent', category: 'auth' } }), { status });
  });
  it('strips the launch code immediately, exchanges it once for the bearer, and preserves navigation', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }, history = { replaceState: vi.fn() }, fetcher = exchange();
    expect(await bootstrapToken({ href: `http://127.0.0.1:12345/?token=${code}&view=all#/installed` }, storage, history, fetcher)).toBe(bearer);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=all#/installed');
    expect(fetcher).toHaveBeenCalledWith('/api/session/bootstrap', expect.objectContaining({ method: 'POST' }));
    expect(storage.setItem).toHaveBeenCalledWith('agentman.token', bearer);
  });
  it('reuses session storage on reload without a network round trip and tolerates storage restrictions', async () => {
    const fetcher = vi.fn();
    expect(await bootstrapToken({ href: 'http://127.0.0.1/' }, { getItem: () => bearer, setItem: vi.fn() }, { replaceState: vi.fn() }, fetcher)).toBe(bearer);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await bootstrapToken({ href: `http://127.0.0.1/?token=${code}` }, { getItem: () => null, setItem: () => { throw new Error('denied'); } }, { replaceState: vi.fn() }, exchange())).toBe(bearer);
  });
  it('keeps a stored bearer when a reopened link has already been spent, and yields nothing otherwise', async () => {
    expect(await bootstrapToken({ href: `http://127.0.0.1/?token=${code}` }, { getItem: () => bearer, setItem: vi.fn() }, { replaceState: vi.fn() }, exchange(401))).toBe(bearer);
    expect(await bootstrapToken({ href: `http://127.0.0.1/?token=${code}` }, { getItem: () => null, setItem: vi.fn() }, { replaceState: vi.fn() }, exchange(401))).toBeNull();
    expect(await bootstrapToken({ href: 'http://127.0.0.1/?token=short' }, { getItem: () => null, setItem: vi.fn() }, { replaceState: vi.fn() }, vi.fn())).toBeNull();
  });
});
it('uses an Authorization header and never places the token in API URLs', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true })));
  const client = new ApiClient('test-token-value', fetcher);
  expect(await client.request('/api/settings', 'PATCH', { telemetryDisabled: true })).toEqual({ ok: true });
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/settings');
  const options = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(new Headers(options.headers).get('authorization')).toBe('Bearer test-token-value');
  expect(options.body).toBe('{"telemetryDisabled":true}');
  expect(options.redirect).toBe('error');
});
it('keeps structured conflict details and prevents requests without a token', async () => {
  const client = new ApiClient('test-token-value', async () => new Response(JSON.stringify({ error: { name: 'ConflictError', message: 'Refresh catalogue', category: 'validation', code: 'STALE_SESSION' } }), { status: 409 }));
  await expect(client.request('/api/installs', 'POST', {})).rejects.toMatchObject({ status: 409, detail: { code: 'STALE_SESSION' } });
  const fetcher = vi.fn();
  await expect(new ApiClient(null, fetcher).request('/api/session')).rejects.toBeInstanceOf(ApiError);
  expect(fetcher).not.toHaveBeenCalled();
});
