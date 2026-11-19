import type { ErrorDto } from '@api-types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly detail: ErrorDto) { super(detail.message); this.name = detail.name; }
}
/** The launch URL carries a single-use code; exchange it for the session bearer before any other request. */
export async function bootstrapToken(location: Pick<Location, 'href'>, storage: Pick<Storage, 'getItem' | 'setItem'>, history: Pick<History, 'replaceState'>, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<string | null> {
  const url = new URL(location.href);
  const supplied = url.searchParams.get('token');
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  const valid = (value: unknown) => typeof value === 'string' && /^[\x21-\x7e]{16,256}$/.test(value) ? value : null;
  const stored = (() => { try { return valid(storage.getItem('agentman.token')); } catch { return null; } })();
  const code = valid(supplied);
  if (!code) return stored;
  try {
    const response = await fetchImpl('/api/session/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), cache: 'no-store', redirect: 'error' });
    if (!response.ok) return stored; // A reopened link is spent; a tab that already holds a bearer keeps working.
    const token = valid(((await response.json()) as { token?: unknown }).token);
    if (!token) return stored;
    try { storage.setItem('agentman.token', token); } catch { /* This tab can still use the in-memory token. */ }
    return token;
  } catch { return stored; }
}

export class ApiClient {
  constructor(private token: string | null, private fetchImpl: typeof fetch = (...args) => fetch(...args)) {}
  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new ApiError(401, { name: 'AuthenticationRequired', message: 'Open the Web UI URL printed by Agent Manager to connect this tab.', category: 'auth' });
    if (!path.startsWith('/api/')) throw new Error('Only local API requests are allowed.');
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    const response = await this.fetchImpl(path, { ...options, headers, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      const envelope = await response.json().catch(() => null);
      throw new ApiError(response.status, envelope?.error ?? { name: 'RequestFailed', message: `Request failed (${response.status}).`, category: 'network' });
    }
    return response;
  }
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const options: RequestInit = { method };
    if (method !== 'GET' && method !== 'HEAD') {
      options.headers = { 'Content-Type': 'application/json' }; options.body = JSON.stringify(body ?? {});
    }
    return (await this.fetch(path, options)).json() as Promise<T>;
  }
}
