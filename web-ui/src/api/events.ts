import type { JobDto, SessionDto, SnapshotDto } from '@api-types';
import { ApiClient, ApiError } from './client.js';

export type ServerEvent = { sequence: number } & (
  { event: 'snapshot'; data: SnapshotDto } | { event: 'session'; data: SessionDto } | { event: 'job'; data: JobDto }
);
/** Streaming decoder handles UTF-8, CRLF, split frames and multi-line data. */
export async function* decodeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', sequence = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8 * 1024 * 1024) throw new Error('Event exceeded the size limit.');
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer); if (!match) break;
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        let event = '', id = '', data = '';
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          if (line.startsWith('id:')) id = line.slice(3).trim();
          if (line.startsWith('data:')) data += `${line.slice(5).trimStart()}\n`;
        }
        const next = Number(id);
        if (!id || !Number.isSafeInteger(next) || next <= sequence) continue;
        sequence = next;
        if (['snapshot', 'session', 'job'].includes(event)) yield { event, sequence, data: JSON.parse(data) } as ServerEvent;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'unauthorised';
export function subscribeEvents(client: ApiClient, onEvent: (event: ServerEvent) => void, onConnection: (state: ConnectionState) => void): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  void (async () => {
    let delay = 500;
    while (!controller.signal.aborted) {
      try {
        const response = await client.fetch('/api/events', { signal: controller.signal });
        if (!response.body) throw new Error('Event stream unavailable.');
        for await (const event of decodeEvents(response.body)) {
          if (controller.signal.aborted) return;
          if (event.event === 'snapshot') { delay = 500; onConnection('connected'); }
          onEvent(event);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) { onConnection('unauthorised'); return; }
      }
      if (controller.signal.aborted) return;
      onConnection('reconnecting');
      await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, delay); });
      delay = Math.min(10_000, delay * 2);
    }
  })();
  return () => { controller.abort(); clearTimeout(timer); wake?.(); };
}
