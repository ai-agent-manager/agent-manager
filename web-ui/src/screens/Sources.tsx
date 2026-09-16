import { Dialog } from '../components/Dialog.js';
import { useState } from 'react';
import type { SourcesDto, StoredSourceDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.js';

export function Sources({ client, onJob }: { client: ApiClient; onJob(id: string): void }) {
  const resource = useResource<SourcesDto>(client, '/api/sources');
  const [value, setValue] = useState('');
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<StoredSourceDto>();
  const reload = async () => { const { jobId } = await client.request<{ jobId: string }>('/api/session/load', 'POST'); onJob(jobId); };
  async function action(route: string, body: unknown, load: boolean) {
    setBusy(true); setError('');
    try { await client.request(route, 'POST', body); setValue(''); setRemove(undefined); resource.refresh(); if (load) await reload(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">DISCOVER MORE</p><h1>Sources</h1><p className="muted">Choose where your skill catalogue comes from.</p></div><button disabled={busy} onClick={resource.refresh}>Refresh</button></div>
    <ErrorMessage message={error || resource.error} />
    <form className="panel source-form" onSubmit={(event) => { event.preventDefault(); void action('/api/sources', { value, activate }, activate); }}><h2>Add a source</h2><label>Source URL or local directory<input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://skills.example.com or /path/to/bundle" required /></label><label className="check-row"><input type="checkbox" checked={activate} onChange={(event) => setActivate(event.target.checked)} />Use this source now</label><button className="primary" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Add source'}</button></form>
    {resource.loading ? <Spinner /> : !resource.data?.sources.length ? <EmptyState title="No sources yet">Add a discovery endpoint, bundle URL, or local bundle directory to get started.</EmptyState> : <div className="source-list">{resource.data.sources.map((source) => {
      const active = resource.data?.active?.kind === source.kind && resource.data.active.value === source.value;
      return <div className="panel row spread" key={`${source.kind}:${source.value}`}><div className="min-width"><span className="badge">{source.kind}</span>{active && <span className="badge succeeded">Active</span>}<p className="break-word">{source.value}</p></div><div className="row"><button aria-label={`${active ? 'Reload' : 'Use'} ${source.value}`} disabled={busy} onClick={() => void action('/api/sources/activate', source, true)}>{active ? 'Reload' : 'Use source'}</button><button aria-label={`Remove ${source.value}`} className="danger" disabled={busy} onClick={() => setRemove(source)}>Remove</button></div></div>;
    })}</div>}
    {remove && <Dialog label="Confirm source removal" onClose={() => { if (!busy) setRemove(undefined); }}><h2>Remove this source?</h2><p className="break-word">{remove.value}</p><p>Your installed skills remain available.</p><div className="row"><button disabled={busy} className="danger" onClick={() => void action('/api/sources/remove', remove, true)}>Confirm removal</button><button onClick={() => setRemove(undefined)}>Cancel</button></div><ErrorMessage message={error} /></Dialog>}
  </>;
}
