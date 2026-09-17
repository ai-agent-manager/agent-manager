import assert from 'node:assert/strict';
import type { JobDto, SessionDto, SnapshotDto } from '../../src/ui-server/api-types.js';

export interface Endpoint { url: string; token: string }
export function api(endpoint: Endpoint, route: string, method = 'GET', body?: unknown) {
  return fetch(new URL(route, endpoint.url), { method, headers: { authorization: `Bearer ${endpoint.token}`,
    ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }), signal: AbortSignal.timeout(15_000) });
}
export async function eventually<T>(read: () => Promise<T>, matches: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (matches(value)) return value;
    assert(Date.now() < deadline, `Timed out waiting for state: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
export const ready = (endpoint: Endpoint, timeoutMs = 10_000) => eventually<SessionDto>(async () => (await api(endpoint, '/api/session')).json(), (session) => session.state === 'ready', timeoutMs);
export const finished = (endpoint: Endpoint, id: string) => eventually<JobDto>(async () => (await api(endpoint, `/api/jobs/${id}`)).json(), (job) => ['succeeded', 'failed', 'cancelled'].includes(job.state));

export async function events(endpoint: Endpoint) {
  const controller = new AbortController();
  const response = await fetch(new URL('/api/events', endpoint.url), { headers: { authorization: `Bearer ${endpoint.token}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder(); let text = '';
  return { async read(): Promise<{ event: string; data: SnapshotDto | SessionDto | JobDto }> {
    while (!text.includes('\n\n')) {
      const chunk = await reader.read(); assert(!chunk.done, 'SSE closed before the expected event');
      text += decoder.decode(chunk.value, { stream: true });
    }
    const index = text.indexOf('\n\n'), frame = text.slice(0, index); text = text.slice(index + 2);
    return { event: frame.match(/event: (.+)/)![1]!, data: JSON.parse(frame.split('data: ')[1]!) };
  }, async close() { controller.abort(); await reader.cancel().catch(() => {}); } };
}
