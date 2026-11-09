import { useState } from 'react';
import type { SettingsDto } from '@api-types';
import type { ApiClient } from '../api/client.js';
import type { Resource } from '../api/hooks.js';
import { ErrorMessage } from './Feedback.js';
import styles from './ThemeSelector.module.css';

/**
 * Radio group over the shared settings resource. App owns that resource and
 * applies `data-theme` from it, so the palette outlives this screen.
 */
export function ThemeSelector({ client, settings }: { client: ApiClient; settings: Resource<SettingsDto> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const theme = settings.data?.uiTheme ?? 'system';

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
    {/* Not disabled while saving: a disabled fieldset drops keyboard focus, and select() already ignores repeat saves. */}
    <fieldset className={styles.selector} disabled={!settings.data} aria-busy={busy}>
      <legend>Appearance</legend>
      <div className={styles.options}>
        {(['system', 'light', 'dark'] as const).map((value) => <label className={styles.option} key={value}>
          <input className="sr-only" type="radio" name="ui-theme" value={value} checked={theme === value} onChange={() => void select(value)} />
          <span>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</span>
        </label>)}
      </div>
    </fieldset>
    <ErrorMessage message={error} />
  </div>;
}
