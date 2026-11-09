import { useState } from 'react';
import type { SettingsDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import type { Resource } from '../api/hooks.js';
import { ErrorMessage, Spinner } from '../components/Feedback.js';
import { ThemeSelector } from '../components/ThemeSelector.js';

export function Settings({ client, settings }: { client: ApiClient; settings: Resource<SettingsDto> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle(key: 'startupUpdateChecksDisabled' | 'telemetryDisabled', value: boolean) {
    if (!settings.data) return;
    const previous = settings.data;
    setBusy(true); setError('');
    settings.update({ ...previous, [key]: value });
    try { settings.update(await client.request<SettingsDto>('/api/settings', 'PATCH', { [key]: value })); }
    catch (error) { settings.update(previous); setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">MAKE IT YOURS</p><h1>Settings</h1><p className="muted">Preferences apply across Agent Manager’s interfaces.</p></div></div>
    <ErrorMessage message={error || settings.error} />
    {settings.error && <button onClick={settings.refresh}>Retry settings</button>}
    {busy && <p className="muted" role="status">Saving…</p>}
    {settings.loading || !settings.data && !settings.error ? <Spinner /> : settings.data && <div className="panel settings">
      {([['startupUpdateChecksDisabled', 'Check for updates at startup', 'Look for newer app and bundle versions when you launch Agent Manager.'], ['telemetryDisabled', 'Share anonymous usage data', 'Help improve Agent Manager by sharing anonymous usage data.']] as const).map(([key, label, help]) => <div className="setting" key={key}><label className="check-row"><input type="checkbox" checked={!settings.data![key] && !settings.data!.envOverrides[key]} disabled={busy || settings.data!.envOverrides[key]} onChange={(event) => void toggle(key, !event.target.checked)} /><span><strong>{label}</strong><small>{help}</small>{settings.data!.envOverrides[key] && <small className="notice">Disabled by an environment setting. Update that setting and restart Agent Manager to enable this option.</small>}</span></label></div>)}
      <div className="setting"><ThemeSelector client={client} settings={settings} /></div>
    </div>}
  </>;
}
