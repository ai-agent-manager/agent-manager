import { useLayoutEffect, useState } from 'react';
import type { SettingsDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import { useResource } from '../api/hooks.js';
import { ErrorMessage } from './Feedback.js';
import styles from './ThemeSelector.module.css';

export function ThemeSelector({ client, enabled }: { client: ApiClient; enabled: boolean }) {
  const settings = useResource<SettingsDto>(client, enabled ? '/api/settings' : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const theme = settings.data?.uiTheme ?? 'system';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => { delete document.documentElement.dataset.theme; };
  }, [theme]);

  async function select(uiTheme: SettingsDto['uiTheme']) {
    if (!settings.data || busy || uiTheme === theme) return;
    const previous = settings.data;
    settings.update({ ...previous, uiTheme });
    setBusy(true); setError('');
    try { settings.update(await client.request<SettingsDto>('/api/settings', 'PATCH', { uiTheme })); }
    catch (error) { settings.update(previous); setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className={styles.container}>
    <fieldset className={styles.selector} disabled={busy || !settings.data} aria-busy={busy}>
      <legend>Appearance</legend>
      <div className={styles.options}>
        {(['system', 'light', 'dark'] as const).map((value) => <label className={styles.option} key={value}>
          <input className="sr-only" type="radio" name="ui-theme" value={value} checked={theme === value} onChange={() => void select(value)} />
          <span>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</span>
        </label>)}
      </div>
    </fieldset>
    <ErrorMessage message={error || settings.error} />
    {settings.error && <button onClick={settings.refresh}>Retry appearance settings</button>}
  </div>;
}
