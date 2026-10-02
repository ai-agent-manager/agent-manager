import { useEffect, useState } from 'react';

export function useHashRoute(): string {
  const current = () => window.location.hash.slice(1) || '/';
  const [route, setRoute] = useState(current);
  useEffect(() => { const changed = () => setRoute(current()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  return route;
}
export function navigate(route: string): void { window.location.hash = route; }
