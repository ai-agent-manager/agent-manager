import { DirectoryField } from '../components/DirectoryField.js';
import { useState } from 'react';
import type { BundleDto, ContextDto, InstalledRecordDto, SessionDto, SkillVersionsDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { Dialog } from '../components/Dialog.js';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.js';

function Selection({ client, record, session, refreshKey, onJob }: { client: ApiClient; record: InstalledRecordDto; session?: SessionDto; refreshKey: string; onJob(id: string): void }) {
  const query = new URLSearchParams({ toolId: record.toolId, scope: record.scope, ...(record.repoRoot ? { repoRoot: record.repoRoot } : {}) });
  const available = useResource<SkillVersionsDto>(client, `/api/skill-versions/${encodeURIComponent(record.installKey)}/available?${query}`, refreshKey);
  const [pending, setPending] = useState<BundleDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (!pending?.bundleId) return;
    setBusy(true); setError('');
    try {
      const { jobId } = await client.request<{ jobId: string }>('/api/skill-versions', 'PUT', { sessionRevision: session!.sessionRevision,
        toolId: record.toolId, installKey: record.installKey, scope: record.scope, ...(record.repoRoot ? { repoRoot: record.repoRoot } : {}), bundleId: pending.bundleId });
      onJob(jobId); setPending(undefined);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="Available skill versions"><h2>{record.skillId}</h2><p>{record.toolId} · {record.scope === 'repo' ? record.repoRoot : 'Personal'}</p><p className="break-word">{record.source?.value ?? 'Origin not recorded'}</p><ErrorMessage message={error || available.error} />
    {available.loading ? <Spinner /> : !available.data?.supported ? <p>{available.data?.reason ?? 'Versions are unavailable.'}</p> : !available.data.bundles.length ? <p>No compatible cached versions. Download a bundle from Versions first.</p> : <ul className="version-list">{available.data.bundles.map((bundle) => <li key={bundle.bundleId}><div><strong>{bundle.version}</strong>{bundle.isCurrent && <span className="badge succeeded">Current</span>}{bundle.reason && <p>{bundle.reason}</p>}</div><button disabled={busy || !bundle.canSelect || bundle.isCurrent || session?.state !== 'ready'} onClick={() => { setPending(bundle); setError(''); }}>Use version {bundle.version}</button></li>)}</ul>}
    {pending && <Dialog label="Change installed skill version" onClose={() => { if (!busy) setPending(undefined); }}><h2>Use {pending.version} for {record.skillId}?</h2><p>Only this installation changes: {record.toolId} · {record.scope === 'repo' ? record.repoRoot : 'Personal'}.</p><ErrorMessage message={error} /><div className="row"><button disabled={busy} onClick={() => setPending(undefined)}>Cancel</button><button className="primary" disabled={busy || session?.state !== 'ready'} onClick={() => void confirm()}>Confirm version</button></div></Dialog>}
  </section>;
}
export function SkillVersions({ client, session, context, refreshKey, onJob }: { client: ApiClient; session?: SessionDto; context?: ContextDto; refreshKey: string; onJob(id: string): void }) {
  const [root, setRoot] = useState(context?.repoRoot ?? '');
  const [applied, setApplied] = useState(context?.repoRoot ?? '');
  const [selected, setSelected] = useState('');
  const instances = useResource<{ instances: InstalledRecordDto[] }>(client, `/api/skill-versions${applied ? `?${new URLSearchParams({ repoRoot: applied })}` : ''}`, refreshKey);
  const key = (record: InstalledRecordDto) => JSON.stringify([record.installKey, record.toolId, record.scope, record.repoRoot]);
  const record = instances.data?.instances.find((record) => key(record) === selected);
  return <>
    <div className="page-heading"><div><p className="eyebrow">INSTALLED SKILLS</p><h1>Skill versions</h1><p className="muted">Choose a version for one tool and scope. Only versions from its recorded source are offered.</p></div><button onClick={instances.refresh}>Refresh</button></div>
    <form className="panel filters" onSubmit={(event) => { event.preventDefault(); setApplied(root); setSelected(''); }}><DirectoryField label="Repository root (optional)" value={root} onChange={setRoot} placeholder="Absolute repository root" /><button>Load installations</button></form>
    <ErrorMessage message={instances.error} />
    {instances.loading ? <Spinner /> : !instances.data?.instances.length ? <EmptyState title="No installed skills">Install a skill first or select another repository.</EmptyState> : <div><label htmlFor="skill-version-installation">Installation</label><select id="skill-version-installation" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select an installation</option>{instances.data.instances.map((record) => <option key={key(record)} value={key(record)}>{record.skillId} · {record.toolId} · {record.scope === 'repo' ? record.repoRoot : 'Personal'} · {record.version}</option>)}</select></div>}
    {record && <Selection key={`${selected}:${session?.sessionRevision}`} client={client} record={record} session={session} refreshKey={refreshKey} onJob={onJob} />}
  </>;
}
