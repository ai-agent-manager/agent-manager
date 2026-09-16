import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContextDto, JobDto, SessionDto } from '@api-types';
import { ApiClient } from './client.js';
import { subscribeEvents, type ConnectionState } from './events.js';

export function useSession(client: ApiClient, enabled = true) {
  const [session, setSession] = useState<SessionDto>();
  const [context, setContext] = useState<ContextDto>();
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, receivedSnapshot = false;
    void client.request<ContextDto>('/api/context').then((value) => { if (!disposed) setContext(value); }).catch((error: Error) => { if (!disposed) setError(error.message); });
    void client.request<SessionDto>('/api/session').then((value) => { if (!disposed && !receivedSnapshot) setSession(value); }).catch((error: Error) => { if (!disposed) setError(error.message); });
    const unsubscribe = subscribeEvents(client, (event) => {
      if (event.event === 'snapshot') { receivedSnapshot = true; setSession(event.data.session); setJobs(event.data.jobs); setError(''); }
      if (event.event === 'session') setSession(event.data);
      if (event.event === 'job') setJobs((current) => [...current.filter((job) => job.id !== event.data.id), event.data].slice(-74));
    }, setConnection);
    return () => { disposed = true; unsubscribe(); };
  }, [client, enabled]);
  return { session, context, jobs, connection, error };
}

export function useResource<T>(client: ApiClient, path: string | null, refreshKey: unknown = 0) {
  const [revision, setRevision] = useState(0);
  const key = useMemo(() => ({ path, refreshKey, revision }), [path, refreshKey, revision]);
  const [state, setState] = useState<{ key: typeof key; data?: T; error: string; loading: boolean }>();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    setState({ key, error: '', loading: !!path });
    if (path) void client.request<T>(path)
      .then((data) => { if (!disposed) setState({ key, data, error: '', loading: false }); })
      .catch((error: Error) => { if (!disposed) setState({ key, error: error.message, loading: false }); });
    return () => { disposed = true; };
  }, [client, key, path]);
  // Never expose a response from the previous path or session revision, even
  // during the render before passive effects have started its replacement.
  const current = state?.key === key ? state : { data: undefined, error: '', loading: !!path };
  const update = (data: T | undefined) => setState({ key, data, error: '', loading: false });
  return { ...current, refresh, update };
}
