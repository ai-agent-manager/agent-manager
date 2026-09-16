import { useEffect, useState, type FormEvent } from 'react';
import type { CatalogueEntryDto, ContextDto, SessionDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { ErrorMessage, Spinner } from '../components/Feedback.js';

export function SkillDetail({ client, skillId, session, context, onJob }: { client: ApiClient; skillId: string; session?: SessionDto; context?: ContextDto; onJob(id: string): void }) {
  const [candidate, setCandidate] = useState('');
  const [scope, setScope] = useState<'system' | 'repo'>('system');
  const [repoRoot, setRepoRoot] = useState(context?.repoRoot ?? '');
  const [appliedRoot, setAppliedRoot] = useState('');
  const query = scope === 'repo' ? `?${new URLSearchParams({ scope, repoRoot: appliedRoot })}` : '';
  const detail = useResource<{ entry: CatalogueEntryDto; readme?: string }>(client, scope === 'repo' && !appliedRoot ? null : `/api/catalogue/skills/${encodeURIComponent(skillId)}${query}`, session?.sessionRevision);
  const [tools, setTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setCandidate(detail.data?.entry.candidates.length === 1 ? detail.data.entry.candidates[0]!.installKey : ''); }, [detail.data]);
  useEffect(() => { setRepoRoot(context?.repoRoot ?? ''); }, [context?.repoRoot]);
  if (!session) return <Spinner>Loading skill…</Spinner>;
  const entry = detail.data?.entry ?? session.catalogue.find((entry) => entry.skillId === skillId);
  const readme = detail.data?.readme;
  if (!entry) return <ErrorMessage message={detail.error || 'Skill unavailable. Return to the catalogue and select it again.'} />;
  async function install(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { jobId } = await client.request<{ jobId: string }>('/api/installs', 'POST', { sessionRevision: session!.sessionRevision, skillId,
        installKey: candidate, scope, ...(scope === 'repo' ? { repoRoot: appliedRoot } : {}), toolIds: tools });
      onJob(jobId);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <a className="back" href="#/">← All skills</a>
    <div className="page-heading"><div><p className="eyebrow">SKILL</p><h1>{entry.displayName}</h1><p className="muted">{entry.description}</p></div></div>
    <div className="detail-grid"><section className="panel"><h2>About this skill</h2>{detail.loading ? <Spinner>Loading skill details…</Spinner> : readme ? <pre className="readme">{readme}</pre> : <p className="muted">{entry.description || 'No README is available.'}</p>}</section>
      <form className="panel install-form" onSubmit={(event) => void install(event)}><h2>Install skill</h2>
        <label>Source<select value={candidate} onChange={(event) => setCandidate(event.target.value)} required><option value="" disabled>Select a source</option>{entry.candidates.map((item, index) => <option key={`${item.installKey}-${index}`} value={item.installKey}>{item.sourceName}{item.sourceStatus ? ` · ${item.sourceStatus}` : ''}{item.version ? ` · ${item.version}` : ''}</option>)}</select></label>
        <label>Install scope<select value={scope} onChange={(event) => { setScope(event.target.value as 'system' | 'repo'); setAppliedRoot(repoRoot); }}><option value="system">Personal · all your projects</option><option value="repo" disabled={!context?.repoRoot}>Repository · {context?.repoName ?? 'no repository detected'}</option></select></label>
        {scope === 'repo' && <div><label>Repository root<input value={repoRoot} onChange={(event) => setRepoRoot(event.target.value)} placeholder="Absolute path to a Git repository" required /></label>{repoRoot !== appliedRoot && <button type="button" onClick={() => setAppliedRoot(repoRoot)}>Load repository catalogue</button>}</div>}
        <fieldset><legend>Tools</legend>{context?.tools.map((tool) => <label className="check-row" key={tool.id}><input type="checkbox" checked={tools.includes(tool.id)} onChange={(event) => setTools((current) => event.target.checked ? [...current, tool.id] : current.filter((id) => id !== tool.id))} /><span>{tool.name}{tool.note && <small>{tool.note}</small>}</span></label>)}</fieldset>
        <ErrorMessage message={error || detail.error} />
        <button className="primary" type="submit" disabled={busy || !detail.data || !candidate || !tools.length || session.state !== 'ready' || scope === 'repo' && repoRoot !== appliedRoot}>{busy ? 'Starting…' : `Install${tools.length ? ` to ${tools.length} tool${tools.length === 1 ? '' : 's'}` : ' skill'}`}</button>
        <small className="muted">Existing installations for these tools will be replaced.</small>
      </form></div>
  </>;
}
