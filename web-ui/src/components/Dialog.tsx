import { useEffect, useRef, type ReactNode } from 'react';

/** Keeps keyboard navigation inside a confirmation and restores its trigger. */
export function Dialog({ label, onClose, children }: { label: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current!;
    const controls = () => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    (controls()[0] ?? panel).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const items = controls();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)!.focus(); }
        else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0]!.focus(); }
      }
    };
    panel.addEventListener('keydown', keydown);
    return () => {
      panel.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
      else document.getElementById('main-content')?.focus();
    };
  }, []);
  return <div className="dialog-backdrop"><div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="panel selection dialog">{children}</div></div>;
}
