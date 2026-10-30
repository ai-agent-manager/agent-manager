import { useState } from 'react';
import type { SessionDto } from '@api-types';
import { EmptyState, Spinner } from '../components/Feedback.js';

export function Catalogue({ session }: { session?: SessionDto }) {
  const [query, setQuery] = useState('');
  if (!session || session.state === 'loading') return <Spinner>Loading your catalogue…</Spinner>;
  const search = query.trim().toLowerCase();
  const entries = session.catalogue.filter((entry) => [entry.skillId, entry.displayName, entry.description, ...entry.candidates.map((candidate) => candidate.sourceName)].some((value) => value.toLowerCase().includes(search)));
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR TOOLKIT</p><h1>Find your next skill</h1><p className="muted">Browse skills and add them to the tools you already use.</p></div><span className="count">{session.catalogue.length} {session.catalogue.length === 1 ? 'skill' : 'skills'}</span></div>
    <label className="search">Search skills<input type="search" placeholder="Search by name, description, or source…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {!entries.length ? <EmptyState title={search ? 'No matching skills' : 'Your catalogue is empty'}>{search ? 'Try another search.' : session.membership.state === 'error' ? 'Project memberships could not be verified. Reload after signing in to see the skills available to you.' : <>Add or activate a source in <a href="#/sources">Sources</a>, then reload the catalogue.</>}</EmptyState>
      : <div className="catalogue-grid">{entries.map((entry) => <a className="skill-card" href={`#/skills/${encodeURIComponent(entry.skillId)}`} key={entry.skillId}>
        <div className="row spread"><span className="skill-icon" aria-hidden="true">⌘</span>{entry.candidates[0]?.sourceStatus && <span className="badge">{entry.candidates[0].sourceStatus}</span>}</div>
        <h2>{entry.displayName}</h2><p>{entry.description || 'No description provided.'}</p>
        <div className="card-footer"><span>{entry.candidates.length === 1 ? entry.candidates[0]!.sourceName : `${entry.candidates.length} sources`}</span><span aria-hidden="true">↗</span></div>
        {!!entry.projectNames?.length && <small className="muted">{entry.projectNames.join(', ')}</small>}
      </a>)}</div>}
  </>;
}
