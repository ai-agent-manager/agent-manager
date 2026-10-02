import { useState } from 'react';
import { desktopBridge } from '../desktop.js';
import { ErrorMessage } from './Feedback.js';

export function DirectoryField({ label, value, onChange, placeholder, required = false }: {
  label: string; value: string; onChange(value: string): void; placeholder?: string; required?: boolean;
}) {
  const bridge = desktopBridge();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function choose() {
    if (!bridge) return;
    setBusy(true); setError('');
    try { const directory = await bridge.pickDirectory(); if (directory !== null) onChange(directory); }
    catch { setError('Could not open the directory picker. Enter the repository path instead.'); }
    finally { setBusy(false); }
  }
  return <div><label>{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></label>
    {bridge && <button type="button" disabled={busy} onClick={() => void choose()} aria-label={`Browse ${label.toLowerCase()}`}>{busy ? 'Choosing…' : 'Browse…'}</button>}
    <ErrorMessage message={error} />
  </div>;
}
