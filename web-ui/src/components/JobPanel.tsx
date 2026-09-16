import { useState } from 'react';
import type { JobDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { ErrorMessage } from './Feedback.js';

const labels: Record<string, string> = { 'session-load': 'Load catalogue', install: 'Install skill', 'install-update': 'Update skill' };
function safeAuthorizeUrl(value?: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if ((url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) && !url.username && !url.password) return url.href; } catch { /* Invalid prompt is not a clickable link. */ }
}
export function JobPanel({ client, jobs, selectedId, onDismiss }: { client: ApiClient; jobs: JobDto[]; selectedId?: string; onDismiss(): void }) {
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string>();
  const active = jobs.filter((job) => job.state === 'queued' || job.state === 'running');
  const selected = jobs.find((job) => job.id === selectedId);
  const visible = [...active, ...(selected && !active.includes(selected) ? [selected] : [])];
  if (!visible.length) return null;
  async function cancel(id: string) {
    setCancelling(id); setError('');
    try { await client.request(`/api/jobs/${id}/cancel`, 'POST'); }
    catch (error) { setError((error as Error).message); }
    finally { setCancelling(undefined); }
  }
  return <aside className="jobs" aria-label="Activity">
    <ErrorMessage message={error} />
    {visible.map((job) => {
      const url = safeAuthorizeUrl(job.authorizeUrl);
      const terminal = !['running', 'queued'].includes(job.state);
      const result = job.result && 'result' in job.result ? job.result.result : undefined;
      return <section className="job" key={job.id} aria-label={labels[job.kind] ?? job.kind}>
        <div className="row spread"><strong>{labels[job.kind] ?? job.kind}</strong><span className={`badge ${job.state}`}>{job.state}</span></div>
        <p role="status">{job.error?.message ?? (terminal ? job.state === 'succeeded' ? 'Finished.' : 'Operation stopped.' : job.progress || 'Waiting to start…')}</p>
        {result && <div>{result.installed.map((item, index) => <p key={`${item.name}-${index}`}>Installed <strong>{item.name}</strong> <span className="muted">({item.method})</span></p>)}{result.errors.map((item, index) => <ErrorMessage key={`${item.name}-${index}`} message={`${item.name}: ${item.error}`} />)}</div>}
        {url && <div className="notice"><strong>Sign in to continue</strong><p>Open the sign-in page, complete authorization, then return to this tab.</p><a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Open sign-in page ↗</a></div>}
        <div className="row">
          {!terminal && <button disabled={!job.canCancel || cancelling === job.id} onClick={() => void cancel(job.id)}>{cancelling === job.id ? 'Cancelling…' : 'Cancel'}</button>}
          {!terminal && !job.canCancel && <small className="muted">{job.phase === 'commit' ? 'Finishing changes…' : 'This phase must finish.'}</small>}
          {terminal && <button onClick={onDismiss}>Dismiss</button>}
        </div>
      </section>;
    })}
  </aside>;
}
