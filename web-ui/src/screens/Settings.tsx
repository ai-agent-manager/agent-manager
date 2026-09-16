import { useState } from 'react';
import type { SettingsDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { ErrorMessage, Spinner } from '../components/Feedback.js';

export function Settings({ client }: { client: ApiClient }) {
  const resource = useResource<SettingsDto>(client, '/api/settings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle(key: 'startupUpdateChecksDisabled' | 'telemetryDisabled', value: boolean) {
    if (!resource.data) return;
    const previous = resource.data;
    setBusy(true); setError('');
    resource.update({ ...previous, [key]: value });
    try { resource.update(await client.request<SettingsDto>('/api/settings', 'PATCH', { [key]: value })); }
    catch (error) { resource.update(previous); setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">MAKE IT YOURS</p><h1>Settings</h1><p className="muted">Preferences apply across agentman’s interfaces.</p></div></div>
    <ErrorMessage message={error || resource.error} />
    {busy && <p className="muted" role="status">Saving…</p>}
    {resource.loading ? <Spinner /> : resource.data && <div className="panel settings">
      {([['startupUpdateChecksDisabled', 'Check for updates at startup', 'Look for newer app and bundle versions when you launch agentman.'], ['telemetryDisabled', 'Share anonymous usage data', 'Help improve agentman by sharing anonymous usage data.']] as const).map(([key, label, help]) => <div className="setting" key={key}><label className="check-row"><input type="checkbox" checked={!resource.data![key] && !resource.data!.envOverrides[key]} disabled={busy || resource.data!.envOverrides[key]} onChange={(event) => void toggle(key, !event.target.checked)} /><span><strong>{label}</strong><small>{help}</small>{resource.data!.envOverrides[key] && <small className="notice">Disabled by an environment setting. Update that setting and restart agentman to enable this option.</small>}</span></label></div>)}
    </div>}
  </>;
}
