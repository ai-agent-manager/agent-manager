import type { ServerResponse } from 'node:http';
import type { SnapshotDto } from './api-types.js';

/** Snapshots and subscription registration are synchronous: no event can land
 * between them. Slow/disconnected clients reconnect for a fresh snapshot.
 */
export class SseHub {
  private sequence = 0;
  private clients = new Map<ServerResponse, ReturnType<typeof setInterval>>();
  constructor(private snapshot: () => SnapshotDto) {}
  attach(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const timer = setInterval(() => this.write(res, 'ping', {}), 25_000);
    timer.unref();
    this.clients.set(res, timer);
    res.on('close', () => { clearInterval(timer); this.clients.delete(res); });
    this.write(res, 'snapshot', this.snapshot());
  }
  broadcast(event: 'job' | 'session', data: unknown): void {
    const frame = this.frame(event, data);
    for (const res of this.clients.keys()) this.send(res, frame);
  }
  private frame(event: string, data: unknown): string {
    return `id: ${++this.sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }
  private write(res: ServerResponse, event: string, data: unknown): void { this.send(res, this.frame(event, data)); }
  private send(res: ServerResponse, frame: string): void {
    if (res.destroyed || res.writableEnded) return;
    if (res.writableLength > 1024 * 1024) { res.destroy(); return; }
    res.write(frame);
  }
  close(): void {
    for (const [res, timer] of this.clients) { clearInterval(timer); res.end(); }
    this.clients.clear();
  }
}
