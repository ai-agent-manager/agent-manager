import { expect, it, vi } from 'vitest';
import { decodeEvents, subscribeEvents } from './events.js';
import { ApiClient } from './client.js';

it('decodes split UTF-8 and CRLF frames, ignoring pings and out-of-order updates', async () => {
  const text = 'id: 1\r\nevent: snapshot\r\ndata: {"name":"café"}\r\n\r\nid: 2\nevent: ping\ndata: {}\n\nid: 1\nevent: session\ndata: {}\n\nid: 3\nevent: job\ndata: {"id":"finished"}\n\n';
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const events = [];
  for await (const event of decodeEvents(stream)) events.push(event);
  expect(events).toEqual([{ event: 'snapshot', sequence: 1, data: { name: 'café' } }, { event: 'job', sequence: 3, data: { id: 'finished' } }]);
});
it('reconnects with a fresh snapshot after a stream ends', async () => {
  const fetcher = vi.fn(async (_path: string, options?: RequestInit) => new Response(new ReadableStream({ start(controller) {
    const sequence = fetcher.mock.calls.length;
    controller.enqueue(new TextEncoder().encode(`id: ${sequence}\nevent: snapshot\ndata: {"session":{},"jobs":[{"id":"${sequence}","state":"succeeded"}]}\n\n`));
    if (sequence === 1) controller.close();
    else options?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
  } })));
  const onEvent = vi.fn(), onConnection = vi.fn();
  const unsubscribe = subscribeEvents(new ApiClient('test-token-value', fetcher as typeof fetch), onEvent, onConnection);
  try {
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(onEvent.mock.calls[1]?.[0].data.jobs).toEqual([{ id: '2', state: 'succeeded' }]);
    expect(onConnection).toHaveBeenCalledWith('reconnecting');
  } finally { unsubscribe(); }
});
it('stops reconnecting when the launch token is rejected', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));
  const onConnection = vi.fn();
  const unsubscribe = subscribeEvents(new ApiClient('test-token-value', fetcher), vi.fn(), onConnection);
  await vi.waitFor(() => expect(onConnection).toHaveBeenCalledWith('unauthorised'));
  expect(fetcher).toHaveBeenCalledOnce(); unsubscribe();
});
