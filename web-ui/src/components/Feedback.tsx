import type { ReactNode } from 'react';

export function ErrorMessage({ message }: { message?: string }) {
  return message ? <div className="notice error" role="alert">{message}</div> : null;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h2>{title}</h2><p>{children}</p></div>;
}
export function Spinner({ children = 'Loading…' }: { children?: ReactNode }) {
  return <p className="muted" role="status"><span className="spinner" aria-hidden="true" /> {children}</p>;
}
