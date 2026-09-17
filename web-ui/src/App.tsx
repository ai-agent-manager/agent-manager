import { Dialog } from './components/Dialog.js';
import { useEffect, useState } from 'react';
import type { AuthDto, JobDto } from '@api-types';
import { ApiClient, ApiError } from './api/client.js';
import { useResource, useSession } from './api/hooks.js';
import { useHashRoute } from './router.js';
import { ErrorMessage } from './components/Feedback.js';
import { JobPanel } from './components/JobPanel.js';
import { Catalogue } from './screens/Catalogue.js';
import { SkillDetail } from './screens/SkillDetail.js';
import { Installed } from './screens/Installed.js';
import { Sources } from './screens/Sources.js';
import { Versions } from './screens/Versions.js';
import { SkillVersions } from './screens/SkillVersions.js';
import { Settings } from './screens/Settings.js';
import styles from './App.module.css';

export function App({ client }: { client: ApiClient }) {
  const [stopped, setStopped] = useState(false);
  const { session, context, jobs, connection, error: sessionError } = useSession(client, !stopped);
  const route = useHashRoute();
  const [selectedJob, setSelectedJob] = useState<string>();
  const [error, setError] = useState('');
  const [quit, setQuit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missingJob, setMissingJob] = useState<JobDto>();
  useEffect(() => { setError(''); }, [route]);
  useEffect(() => {
    if (!selectedJob || jobs.some((job) => job.id === selectedJob)) { setMissingJob(undefined); return; }
    let disposed = false;
    void client.request<JobDto>(`/api/jobs/${selectedJob}`).then((job) => { if (!disposed) setMissingJob(job); }).catch((error: Error) => {
      if (disposed) return;
      setError(error instanceof ApiError && error.status === 404 ? 'This activity is no longer retained. Refresh the catalogue or installed skills to see the current state.' : error.message);
    });
    return () => { disposed = true; };
  }, [client, selectedJob, jobs]);
  const refreshKey = jobs.filter((job) => ['succeeded', 'failed', 'cancelled'].includes(job.state)).map((job) => `${job.id}:${job.state}`).sort().join(',');
  const authStatus = useResource<AuthDto>(client, session && session.state !== 'loading' && connection !== 'unauthorised' ? '/api/auth' : null, `${session?.sessionRevision}:${session?.state}:${refreshKey}`);
  const auth = authStatus.data ?? session?.auth;
  async function reload() {
    setError(''); setBusy(true);
    try { const { jobId } = await client.request<{ jobId: string }>('/api/session/load', 'POST'); setSelectedJob(jobId); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function authAction() {
    setError(''); setBusy(true);
    try {
      if (auth?.authenticated) await client.request('/api/auth/logout', 'POST');
      else { const { jobId } = await client.request<{ jobId: string }>('/api/auth/login', 'POST'); setSelectedJob(jobId); }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function shutdown() {
    setError(''); setBusy(true);
    try { await client.request('/api/shutdown', 'POST'); setStopped(true); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  let skillId: string | undefined;
  if (route.startsWith('/skills/')) { try { skillId = decodeURIComponent(route.slice('/skills/'.length)); } catch { /* Invalid navigation renders the not-found screen. */ } }
  if (stopped) return <main className="empty"><h1>Agent Manager is shutting down</h1><p>Any changes already in progress will finish before the server stops. You can close this tab.</p></main>;
  return <div className={styles.app}>
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#/" aria-label="Agent Manager home"><span className={styles.logo} aria-hidden="true">a</span><span>Agent Manager</span></a>
      <nav aria-label="Main navigation">{[['/', 'Catalogue', '⌘'], ['/installed', 'Installed', '▦'], ['/sources', 'Sources', '◎'], ['/versions', 'Versions', '◷'], ['/skill-versions', 'Skill versions', '⇄'], ['/settings', 'Settings', '⚙']].map(([href, label, icon]) => <a href={`#${href}`} key={href} className={(route === href || href === '/' && route.startsWith('/skills/')) ? styles.active : ''} aria-current={(route === href || href === '/' && route.startsWith('/skills/')) ? 'page' : undefined}><span aria-hidden="true">{icon}</span>{label}</a>)}</nav>
      <div className={styles.sidebarBottom}><span className="status-dot" />Running locally<small>v{context?.appVersion ?? '…'}</small><button onClick={() => setQuit(true)}>Quit Agent Manager</button></div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.header}><div className="min-width"><small className="muted">ACTIVE SOURCE</small><div className={styles.source} title={session?.source?.value}>{session?.source?.value ?? 'No source selected'}</div></div><div className="row">{session?.bundleVersion && <span className="badge">{session.bundleVersion}</span>}<span className="badge">{auth?.authenticated ? 'Signed in' : auth?.required ? 'Sign-in required' : 'Local session'}</span>{auth?.required && <button disabled={busy || session?.state === 'loading'} onClick={() => void authAction()}>{auth.authenticated ? 'Sign out' : 'Sign in'}</button>}<button disabled={busy || session?.state === 'loading'} onClick={() => void reload()}>{session?.state === 'loading' ? 'Loading…' : 'Reload'}</button></div></header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <ErrorMessage message={connection === 'unauthorised' ? 'This tab is not authorized. Open the Web UI URL printed by Agent Manager.' : error || sessionError || session?.error?.message} />
        {connection === 'reconnecting' && <div className="notice" role="status">Connection lost. Reconnecting and refreshing activity…</div>}
        {session?.warnings.map((warning, index) => <div className="notice" key={index}>{warning}</div>)}
        {session?.startupNotices.map((notice, index) => <div className="notice" key={index}>{notice.message}</div>)}
        {connection === 'unauthorised' || !session && sessionError ? null : route === '/' ? <Catalogue session={session} />
          : skillId ? <SkillDetail key={`${skillId}:${session?.sessionRevision}`} client={client} skillId={skillId} session={session} context={context} onJob={setSelectedJob} />
          : route === '/installed' ? <Installed client={client} context={context} refreshKey={refreshKey} onJob={setSelectedJob} />
          : route === '/sources' ? <Sources client={client} onJob={setSelectedJob} />
          : route === '/versions' ? <Versions key={session?.sessionRevision} client={client} session={session} context={context} refreshKey={refreshKey} onJob={setSelectedJob} />
          : route === '/skill-versions' ? <SkillVersions client={client} session={session} context={context} refreshKey={refreshKey} onJob={setSelectedJob} />
          : route === '/settings' ? <Settings client={client} />
          : <div className="empty"><h1>Page not found</h1><a href="#/">Return to the catalogue</a></div>}
        {quit && <Dialog label="Confirm quit" onClose={() => { if (!busy) setQuit(false); }}><h2>Quit Agent Manager?</h2><p>Changes already in progress will finish before the server stops.</p><div className="row"><button className="danger" disabled={busy} onClick={() => void shutdown()}>Quit</button><button onClick={() => setQuit(false)}>Keep working</button></div><ErrorMessage message={error} /></Dialog>}
      </main>
      <JobPanel client={client} jobs={missingJob && !jobs.some((job) => job.id === missingJob.id) ? [...jobs, missingJob] : jobs} selectedId={selectedJob} onDismiss={() => setSelectedJob(undefined)} />
    </div>
  </div>;
}
