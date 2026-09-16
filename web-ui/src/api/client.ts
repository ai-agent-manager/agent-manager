import type { ErrorDto } from '@api-types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly detail: ErrorDto) { super(detail.message); this.name = detail.name; }
}
export function bootstrapToken(location: Pick<Location, 'href'>, storage: Pick<Storage, 'getItem' | 'setItem'>, history: Pick<History, 'replaceState'>): string | null {
  const url = new URL(location.href);
  const supplied = url.searchParams.get('token');
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }
  const valid = (value: string | null) => value && /^[\x21-\x7e]{16,256}$/.test(value) ? value : null;
  if (supplied !== null) {
    const token = valid(supplied);
    if (token) { try { storage.setItem('agentman.token', token); } catch { /* This tab can still use the in-memory token. */ } }
    return token;
  }
  try { return valid(storage.getItem('agentman.token')); } catch { return null; }
}

export class ApiClient {
  constructor(private token: string | null, private fetchImpl: typeof fetch = (...args) => fetch(...args)) {}
  async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new ApiError(401, { name: 'AuthenticationRequired', message: 'Open the Web UI URL printed by agentman to connect this tab.', category: 'auth' });
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
