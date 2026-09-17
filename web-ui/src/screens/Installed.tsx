import { DirectoryField } from '../components/DirectoryField.js';
import { Dialog } from '../components/Dialog.js';
import { useState } from 'react';
import type { ContextDto, InstalledRecordDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.js';

function instanceQuery(record: InstalledRecordDto): string {
  return new URLSearchParams({ scope: record.scope, toolId: record.toolId, ...(record.repoRoot ? { repoRoot: record.repoRoot } : {}) }).toString();
}
export function Installed({ client, context, refreshKey, onJob }: { client: ApiClient; context?: ContextDto; refreshKey: string; onJob(id: string): void }) {
  const [scope, setScope] = useState('all');
  const [tool, setTool] = useState('all');
  const [repoRoot, setRepoRoot] = useState(context?.repoRoot ?? '');
  const [selected, setSelected] = useState<InstalledRecordDto>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = new URLSearchParams({ scope, ...(repoRoot ? { repoRoot } : {}) });
  const records = useResource<{ records: InstalledRecordDto[] }>(client, `/api/installs?${query}`, refreshKey);
  const shown = records.data?.records.filter((record) => tool === 'all' || record.toolId === tool) ?? [];
  async function remove() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const { result } = await client.request<{ result: { errors: Array<{ error: string }> } }>(`/api/installs/${encodeURIComponent(selected.installKey)}?${instanceQuery(selected)}`, 'DELETE');
      if (result.errors.length) throw new Error(result.errors.map((item) => item.error).join('\n'));
      setSelected(undefined); setConfirmRemove(false); records.refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function update(record: InstalledRecordDto) {
    setBusy(true); setError('');
    try {
      const { jobId } = await client.request<{ jobId: string }>(`/api/installs/${encodeURIComponent(record.installKey)}/update`, 'POST', {
        scope: record.scope, toolId: record.toolId, ...(record.repoRoot ? { repoRoot: record.repoRoot } : {}),
      });
      onJob(jobId);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR SETUP</p><h1>Installed skills</h1><p className="muted">See what’s available to each tool and keep it up to date.</p></div><button onClick={records.refresh}>Refresh</button></div>
    <div className="filters"><label>Scope<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">All scopes</option><option value="system">Personal</option><option value="repo">Repository</option></select></label><label>Tool<select value={tool} onChange={(event) => setTool(event.target.value)}><option value="all">All tools</option>{context?.tools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><DirectoryField label="Repository root" value={repoRoot} onChange={setRepoRoot} placeholder={context?.repoRoot ?? 'Optional absolute repository path'} /></div>
    <ErrorMessage message={error || records.error} />
    {records.loading ? <Spinner /> : !shown.length ? <EmptyState title="No installed skills">Install a skill from the <a href="#/">catalogue</a>, or change your filters.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Skill</th><th>Tool / scope</th><th>Version</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shown.map((record) => <tr key={`${record.installKey}-${record.toolId}-${record.scope}-${record.repoRoot}`}>
      <td><strong>{record.skillId}</strong><small>{record.installKey}</small></td><td>{context?.tools.find((tool) => tool.id === record.toolId)?.name ?? record.toolId}<small>{record.scope === 'system' ? 'Personal' : record.repoRoot ?? 'Repository'}</small></td><td><code>{record.version || 'Unknown'}</code></td>
      <td className="actions"><button aria-label={`Info ${record.skillId} for ${record.toolId} (${record.scope}${record.repoRoot ? `: ${record.repoRoot}` : ''})`} onClick={() => { setSelected(record); setConfirmRemove(false); setError(''); }}>Info</button><button aria-label={`Update ${record.skillId} for ${record.toolId} (${record.scope}${record.repoRoot ? `: ${record.repoRoot}` : ''})`} disabled={busy} onClick={() => void update(record)}>Update</button><button aria-label={`Remove ${record.skillId} for ${record.toolId} (${record.scope}${record.repoRoot ? `: ${record.repoRoot}` : ''})`} className="danger" onClick={() => { setSelected(record); setConfirmRemove(true); setError(''); }}>Remove</button></td>
    </tr>)}</tbody></table></div>}
    {selected && <Dialog label={confirmRemove ? 'Confirm removal' : 'Installation details'} onClose={() => { if (!busy) setSelected(undefined); }}><div className="row spread"><h2>{confirmRemove ? `Remove ${selected.skillId}?` : selected.skillId}</h2><button onClick={() => setSelected(undefined)} disabled={busy}>Close</button></div>
      <dl><dt>Tool</dt><dd>{selected.toolId}</dd><dt>Scope</dt><dd>{selected.scope === 'system' ? 'Personal' : selected.repoRoot}</dd><dt>Version</dt><dd>{selected.version || 'Unknown'}</dd><dt>Source</dt><dd>{selected.source?.value ?? 'Not recorded'}</dd><dt>Installed</dt><dd>{selected.installedAt}</dd><dt>Method</dt><dd>{selected.method}</dd></dl>
      {confirmRemove && <><p>This removes the skill from this tool and scope.</p><button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Confirm removal'}</button></>}
      <ErrorMessage message={error} />
    </Dialog>}
  </>;
}
