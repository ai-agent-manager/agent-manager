import { useState } from 'react';
import type { BundleDto, BundlesDto, ContextDto, RemoteBundlesDto, SessionDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { Dialog } from '../components/Dialog.js';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.js';

export function Versions({ client, session, context, refreshKey, onJob }: { client: ApiClient; session?: SessionDto; context?: ContextDto; refreshKey: string; onJob(id: string): void }) {
  const cached = useResource<BundlesDto>(client, '/api/bundles', `${session?.sessionRevision}:${refreshKey}`);
  const [browse, setBrowse] = useState(false);
  const remote = useResource<RemoteBundlesDto>(client, browse && session?.state === 'ready' ? '/api/bundles/remote' : null, session?.sessionRevision);
  const [pending, setPending] = useState<{ bundle: BundleDto; action: 'select' | 'remove' }>();
  const [sync, setSync] = useState(false);
  const [repoRoot, setRepoRoot] = useState(context?.repoRoot ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download(bundleId: string) {
    setError(''); setBusy(true);
    try { const { jobId } = await client.request<{ jobId: string }>('/api/bundles/download', 'POST', { sessionRevision: remote.data!.sessionRevision, bundleId }); onJob(jobId); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!pending) return;
    setError(''); setBusy(true);
    try {
      if (pending.action === 'remove') { await client.request(`/api/bundles/${pending.bundle.removalId}`, 'DELETE'); cached.refresh(); }
      else {
        const { jobId } = await client.request<{ jobId: string }>('/api/bundles/current', 'POST', { sessionRevision: session!.sessionRevision,
          bundleId: pending.bundle.bundleId, syncInstalled: sync, ...(sync && repoRoot ? { repoRoot } : {}) });
        onJob(jobId);
      }
      setPending(undefined);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">BUNDLES</p><h1>Versions</h1><p className="muted">Manage cached bundles and download versions from your current source.</p></div><button onClick={cached.refresh}>Refresh</button></div>
    <ErrorMessage message={error || cached.error} />
    <section aria-label="Cached bundles"><h2>Cached bundles</h2>
      {cached.loading ? <Spinner /> : !cached.data?.cached.length ? <EmptyState title="No cached bundles">Load a bundle source to get started.</EmptyState> : <div className="source-list">{cached.data.cached.map((bundle, index) => <article className="panel" key={bundle.bundleId ?? `unsupported-${index}`}>
        <div className="row spread"><h3>{bundle.version}</h3>{bundle.isCurrent && <span className="badge succeeded">Current</span>}</div>
        <p className="break-word">{bundle.source?.name && <strong>{bundle.source.name} · </strong>}{bundle.source?.value ?? 'Origin not verified'}</p><p className="muted">{bundle.cacheKind === 'named' ? 'Named source · select per installed skill' : 'Global bundle'}{bundle.published && ` · ${bundle.published.slice(0, 10)}`}</p>
        {bundle.reason && <p>{bundle.reason}</p>}{bundle.removalReason && <p>{bundle.removalReason}</p>}
        <div className="row"><button disabled={busy || !bundle.canSelect || bundle.isCurrent || session?.state !== 'ready'} onClick={() => { setPending({ bundle, action: 'select' }); setSync(false); setError(''); }}>Use version {bundle.version}</button><button className="danger" disabled={busy || !bundle.canRemove} onClick={() => { setPending({ bundle, action: 'remove' }); setError(''); }}>Remove version {bundle.version}</button></div>
      </article>)}</div>}
    </section>
    <section className="panel" aria-label="Remote versions"><div className="row spread"><h2>Remote versions</h2><button disabled={busy || !cached.data?.canBrowseRemote || session?.state !== 'ready' || remote.loading} onClick={() => { setBrowse(true); if (browse) remote.refresh(); }}>Browse remote versions</button></div>
      {cached.data?.reason && <p>{cached.data.reason}</p>}
      <ErrorMessage message={remote.error} />
      {remote.loading ? <Spinner>Loading remote versions…</Spinner> : remote.data && (!remote.data.bundles.length ? <p>No remote bundle versions are available.</p> : <ul className="version-list">{remote.data.bundles.map((bundle) => <li key={bundle.bundleId}><div><strong>{bundle.version}</strong><p className="break-word">{bundle.source.name ? `${bundle.source.name} · ` : ''}{bundle.source.value}</p><small>{bundle.published.slice(0, 10)}</small></div><button disabled={busy} onClick={() => void download(bundle.bundleId)}>Download {bundle.version}{bundle.source.name ? ` from ${bundle.source.name}` : ''}</button></li>)}</ul>)}
    </section>
    <p>Use <a href="#/skill-versions">Skill versions</a> to change an individual installation, including named discovery sources.</p>
    {pending && <Dialog label={pending.action === 'select' ? 'Select bundle version' : 'Remove cached bundle'} onClose={() => { if (!busy) setPending(undefined); }}>
      <h2>{pending.action === 'select' ? 'Use' : 'Remove'} version {pending.bundle.version}?</h2><p className="break-word">{pending.bundle.source?.value}</p>
      {pending.action === 'select' ? <><p>This changes the active catalogue.</p><label className="check-row"><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} />Also sync installed skills from this source</label>{sync && <label>Repository to include (optional)<input value={repoRoot} onChange={(event) => setRepoRoot(event.target.value)} placeholder="Absolute repository root" /></label>}<p className="muted">Sync includes personal installations and the repository selected above. Other source identities are kept separate; any sync failures appear in Activity.</p></> : <p>Bundles still used by an installation cannot be removed.</p>}
      <ErrorMessage message={error} /><div className="row"><button disabled={busy} onClick={() => setPending(undefined)}>Cancel</button><button className={pending.action === 'remove' ? 'danger' : 'primary'} disabled={busy || pending.action === 'select' && session?.state !== 'ready'} onClick={() => void confirm()}>{busy ? 'Working…' : pending.action === 'select' ? 'Confirm version' : 'Confirm removal'}</button></div>
    </Dialog>}
  </>;
}
