import { randomUUID } from 'node:crypto';
import { OperationCancelledError, checkOperationCancelled } from '../operations/cancellation.js';
import { AuthCancelledError } from '../auth/flow.js';
import { ConflictError, HttpError, serialiseError, ValidationError } from './errors.js';
import { safeText } from './dto.js';
import type { JobDto, JobPhase, JobResult } from './api-types.js';

export interface JobContext {
  signal: AbortSignal;
  progress(message: string): void;
  phase(phase: Exclude<JobPhase, 'queued' | 'complete'>): void;
  authPrompt(url: string): void;
  auth<T>(run: () => Promise<T>): Promise<T>;
}
interface Job {
  dto: JobDto; controller: AbortController; run: (context: JobContext) => Promise<JobResult>;
  done: Promise<void>; finish: () => void;
}
const terminal = (job: JobDto) => ['succeeded', 'failed', 'cancelled'].includes(job.state);

export class JobRegistry {
  private jobs = new Map<string, Job>();
  private listeners = new Set<(job: JobDto) => void>();
  private running = 0;
  private stopping = false;
  constructor(private limits = { concurrent: 4, queued: 20, finished: 50 }) {}

  start(kind: string, run: Job['run']): string {
    if (this.stopping) throw new HttpError(503, 'The server is stopping.', 'STOPPING');
    if ([...this.jobs.values()].filter((job) => job.dto.state === 'queued').length >= this.limits.queued) {
      throw new ConflictError('The job queue is full. Wait for current work to finish.', 'QUEUE_FULL');
    }
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const dto: JobDto = { id: randomUUID(), kind, state: 'queued', phase: 'queued', canCancel: true, progress: '' };
    this.jobs.set(dto.id, { dto, controller: new AbortController(), run, done, finish });
    this.emit(dto);
    queueMicrotask(() => this.pump());
    return dto.id;
  }
  get(id: string): JobDto {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, 'Job unavailable. Refresh the affected resources.', 'JOB_NOT_FOUND');
    return structuredClone(job.dto);
  }
  /** Main-process desktop policy checks exact live prompts, never renderer claims. */
  isActiveAuthorizationUrl(url: string): boolean {
    return !this.stopping && [...this.jobs.values()].some((job) => !job.controller.signal.aborted
      && job.dto.state === 'running' && job.dto.phase === 'auth' && job.dto.authorizeUrl === url);
  }
  snapshot(): JobDto[] { return [...this.jobs.values()].map((job) => structuredClone(job.dto)); }
  subscribe(listener: (job: JobDto) => void): () => void {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  private emit(dto: JobDto): void { for (const listener of this.listeners) listener(structuredClone(dto)); }
  async wait(id: string): Promise<void> { await this.jobs.get(id)?.done; }
  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) { this.get(id); return; }
    if (terminal(job.dto)) throw new ConflictError('The job has already finished.', 'JOB_FINISHED');
    if (!job.dto.canCancel) throw new ConflictError('This phase must finish before the job can stop.', 'JOB_NOT_CANCELLABLE');
    job.controller.abort();
    if (job.dto.state === 'queued') this.complete(job, 'cancelled');
    // Acknowledgement means callback listeners and token exchange have settled.
    await job.done;
  }
  async cancelAndWait(predicate: (job: JobDto) => boolean): Promise<void> {
    const selected = [...this.jobs.values()].filter((job) => !terminal(job.dto) && predicate(job.dto));
    await Promise.all(selected.map(async (job) => {
      if (job.dto.canCancel) await this.cancel(job.dto.id);
      else await job.done;
    }));
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await this.cancelAndWait(() => true);
  }
  private pump(): void {
    if (this.stopping) return;
    for (const job of this.jobs.values()) {
      if (this.running >= this.limits.concurrent) break;
      if (job.dto.state !== 'queued') continue;
      this.running++;
      job.dto.state = 'running'; job.dto.phase = 'resolving'; job.dto.canCancel = false;
      this.emit(job.dto);
      void this.execute(job);
    }
  }
  private async execute(job: Job): Promise<void> {
    const context: JobContext = {
      signal: job.controller.signal,
      progress: (message) => { job.dto.progress = safeText(message).slice(0, 8192); this.emit(job.dto); },
      phase: (phase) => {
        if (phase === 'auth' && this.stopping) job.controller.abort();
        checkOperationCancelled(job.controller.signal);
        job.dto.phase = phase; job.dto.canCancel = phase === 'auth';
        if (phase !== 'auth') delete job.dto.authorizeUrl;
        this.emit(job.dto);
      },
      authPrompt: (value) => {
        let url: URL;
        try { url = new URL(value); } catch { throw new ValidationError('Invalid authorization URL.'); }
        if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || url.username || url.password) throw new ValidationError('Authorization requires HTTPS or loopback HTTP, without credentials.');
        checkOperationCancelled(job.controller.signal);
        job.dto.authorizeUrl = url.href; this.emit(job.dto);
      },
      auth: async (run) => {
        context.phase('auth');
        try { const result = await run(); checkOperationCancelled(job.controller.signal); return result; }
        finally {
          // Do not throw from cleanup; the original cancellation/error is retained.
          delete job.dto.authorizeUrl;
          job.dto.phase = 'download'; job.dto.canCancel = false; this.emit(job.dto);
        }
      },
    };
    try {
      const result = await job.run(context);
      checkOperationCancelled(job.controller.signal);
      job.dto.result = result;
      this.complete(job, 'succeeded');
    } catch (error) {
      job.dto.error = serialiseError(error).body.error;
      this.complete(job, error instanceof OperationCancelledError || error instanceof AuthCancelledError
        || job.controller.signal.aborted ? 'cancelled' : 'failed');
    } finally { this.running--; this.pump(); }
  }
  private complete(job: Job, state: 'succeeded' | 'failed' | 'cancelled'): void {
    if (terminal(job.dto)) return;
    job.dto.state = state; job.dto.phase = 'complete'; job.dto.canCancel = false;
    delete job.dto.authorizeUrl;
    this.emit(job.dto); job.finish();
    this.jobs.delete(job.dto.id); this.jobs.set(job.dto.id, job);
    const finished = [...this.jobs.values()].filter((item) => terminal(item.dto));
    for (const old of finished.slice(0, Math.max(0, finished.length - this.limits.finished))) this.jobs.delete(old.dto.id);
  }
}
