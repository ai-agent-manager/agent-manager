import { useState, type ReactNode } from 'react';

export function CloseButton({ label, onClick }: { label: string; onClick(): void }) {
  return <button type="button" className="close-button" aria-label={label} title={label} onClick={onClick}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg></button>;
}

export function Notice({ children, error = false, role }: { children: ReactNode; error?: boolean; role?: 'alert' | 'status' }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <div className={`notice dismissible${error ? ' error' : ''}`} role={role}>
    <div>{children}</div><CloseButton label={error ? 'Dismiss error' : 'Dismiss notice'} onClick={() => setDismissed(true)} />
  </div>;
}

export function ErrorMessage({ message }: { message?: string }) {
  return message ? <Notice key={message} error role="alert">{message}</Notice> : null;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h2>{title}</h2><p>{children}</p></div>;
}
export function Spinner({ children = 'Loading…' }: { children?: ReactNode }) {
  return <p className="muted" role="status"><span className="spinner" aria-hidden="true" /> {children}</p>;
}
