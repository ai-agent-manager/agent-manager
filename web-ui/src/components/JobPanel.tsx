import { useCallback, useEffect, useState } from 'react';
import type { JobDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { CloseButton, ErrorMessage, Notice } from './Feedback.js';

const labels: Record<string, string> = { 'session-load': 'Load catalogue', install: 'Install skill', 'install-update': 'Update skill', 'auth-login': 'Sign in', 'bundle-download': 'Download bundle', 'bundle-select': 'Select bundle', 'skill-version-select': 'Change skill version' };
function safeAuthorizeUrl(value?: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if ((url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) && !url.username && !url.password) return url.href; } catch { /* Invalid prompt is not a clickable link. */ }
}
function isActive(job: JobDto) { return job.state === 'queued' || job.state === 'running'; }

export function JobPanel({ client, jobs, selectedId, onDismiss }: { client: ApiClient; jobs: JobDto[]; selectedId?: string; onDismiss(id: string): void }) {
  const [observed, setObserved] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  // Keep results for jobs seen running, including overlapping jobs. Historical
  // completed jobs from the initial SSE snapshot should not become new toasts.
  useEffect(() => {
    setObserved((previous) => {
      const next = jobs.filter((job) => previous.includes(job.id) || isActive(job) || job.id === selectedId).map((job) => job.id);
      return next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    });
  }, [jobs, selectedId]);
  const dismiss = useCallback((id: string) => {
    setDismissed((previous) => [...previous, id]);
    onDismiss(id);
  }, [onDismiss]);
  const visible = jobs.filter((job) => !dismissed.includes(job.id) && (isActive(job) || job.id === selectedId || observed.includes(job.id)));
  return <aside className="job-toasts" aria-label="Activity">{visible.map((job) => <JobToast key={job.id} client={client} job={job} onDismiss={dismiss} />)}</aside>;
}

function JobToast({ client, job, onDismiss }: { client: ApiClient; job: JobDto; onDismiss(id: string): void }) {
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const terminal = !isActive(job);
  const result = job.result && 'result' in job.result ? job.result.result : undefined;
  const failures = job.result && 'failures' in job.result ? job.result.failures : [];
  const superseded = !!(job.result && 'superseded' in job.result && job.result.superseded);
  const hasIssues = !!job.error || !!result?.errors.length || failures.length > 0 || superseded;
  const autoDismiss = job.state === 'succeeded' && !hasIssues && !error;
  useEffect(() => {
    if (!autoDismiss || hovered || focused) return;
    const timer = window.setTimeout(() => onDismiss(job.id), 8000);
    return () => window.clearTimeout(timer);
  }, [autoDismiss, hovered, focused, job.id, onDismiss]);
  async function cancel(id: string) {
    setCancelling(true); setError('');
    try { await client.request(`/api/jobs/${id}/cancel`, 'POST'); }
    catch (error) { setError((error as Error).message); }
    finally { setCancelling(false); }
  }
  const url = !terminal ? safeAuthorizeUrl(job.authorizeUrl) : undefined;
  const label = labels[job.kind] ?? job.kind;
  return <section className={`job-toast ${hasIssues ? 'failed' : job.state}`} aria-label={label}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className="toast-heading"><strong>{label}</strong><span className={`badge ${job.state}`}>{job.state}</span>{terminal && <CloseButton label={`Dismiss ${label} notification`} onClick={() => onDismiss(job.id)} />}</div>
    <p role="status" aria-atomic="true">{!terminal && <span className="spinner" aria-hidden="true" />} {job.error?.message ?? (terminal ? job.state === 'succeeded' ? hasIssues ? 'Finished with issues. Review the details below.' : 'Finished.' : 'Operation stopped.' : job.progress || 'Waiting to start…')}</p>
    <ErrorMessage message={error} />
    {superseded && <Notice role="status">The switch applied, but a newer catalogue load superseded its selection. Installed skills may keep the switched version; review Skill versions before syncing again.</Notice>}
    {failures.length > 0 && <Notice><strong>Bundle selected with sync failures</strong>{failures.map((failure, index) => <ErrorMessage key={index} message={failure} />)}</Notice>}
    {result && <div>{result.installed.map((item, index) => <p key={`${item.name}-${index}`}>Installed <strong>{item.name}</strong> <span className="muted">({item.method})</span></p>)}{result.errors.map((item, index) => <ErrorMessage key={`${item.name}-${index}`} message={`${item.name}: ${item.error}`} />)}</div>}
    {url && <div className="notice"><strong>Sign in to continue</strong><p>Open the sign-in page, complete authorization, then return to this tab.</p><a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Open sign-in page ↗</a></div>}
    <div className="row">
      {!terminal && <button disabled={!job.canCancel || cancelling} onClick={() => void cancel(job.id)}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>}
      {!terminal && !job.canCancel && <small className="muted">{job.phase === 'commit' ? 'Finishing changes…' : 'This phase must finish.'}</small>}
    </div>
  </section>;
}
