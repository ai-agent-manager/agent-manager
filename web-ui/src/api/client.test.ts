import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, bootstrapToken } from './client.js';

describe('token bootstrap', () => {
  it('stores the launch token, strips it immediately, and preserves navigation', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }, history = { replaceState: vi.fn() };
    const token = '12345678-1234-4234-8234-123456789abc';
    expect(bootstrapToken({ href: `http://127.0.0.1:12345/?token=${token}&view=all#/installed` }, storage, history)).toBe(token);
    expect(storage.setItem).toHaveBeenCalledWith('agentman.token', token);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?view=all#/installed');
  });
  it('reuses session storage on reload and tolerates storage restrictions', () => {
    const token = '12345678-1234-4234-8234-123456789abc';
    expect(bootstrapToken({ href: 'http://127.0.0.1/' }, { getItem: () => token, setItem: vi.fn() }, { replaceState: vi.fn() })).toBe(token);
    expect(bootstrapToken({ href: `http://127.0.0.1/?token=${token}` }, { getItem: () => null, setItem: () => { throw new Error('denied'); } }, { replaceState: vi.fn() })).toBe(token);
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
