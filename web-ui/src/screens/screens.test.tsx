import { App } from '../App.js';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContextDto, InstalledRecordDto, JobDto, SessionDto } from '@api-types';
import { ApiClient } from '../api/client.js';
import { Catalogue } from './Catalogue.js';
import { SkillDetail } from './SkillDetail.js';
import { Installed } from './Installed.js';
import { Sources } from './Sources.js';
import { Settings } from './Settings.js';
import { JobPanel } from '../components/JobPanel.js';

const context: ContextDto = { appVersion: '0.0.0', platform: 'linux', cwd: '/example/repo', repoRoot: '/example/repo', repoName: 'repo', tools: [{ id: 'claude-code', name: 'Claude Code' }] };
const entry = { kind: 'skill' as const, skillId: 'test-skill', displayName: 'Test Skill', description: 'A useful test skill', candidates: [{ installKey: 'bundle/test/test-skill', sourceName: 'Test source', sourceType: 'http' as const, sourceStatus: 'official' as const }] };
const session: SessionDto = { state: 'ready', sessionRevision: 7, auth: { required: false, authenticated: false }, membership: { state: 'not-required' }, catalogue: [entry], warnings: [], startupNotices: [] };
function mockApi(handler: (path: string, options: RequestInit) => unknown) {
  const fetcher = vi.fn(async (path: RequestInfo | URL, options: RequestInit = {}) => new Response(JSON.stringify(handler(String(path), options))));
  return { client: new ApiClient('test-token-value', fetcher), fetcher };
}

it('searches catalogue content and preserves source trust labels', async () => {
  render(<Catalogue session={session} />);
  expect(screen.getByText('official')).toBeTruthy();
  await userEvent.type(screen.getByRole('searchbox'), 'nonexistent');
  expect(screen.getByText('No matching skills')).toBeTruthy();
  await userEvent.clear(screen.getByRole('searchbox'));
  await userEvent.type(screen.getByRole('searchbox'), 'test source');
  expect(screen.getByRole('heading', { name: 'Test Skill' })).toBeTruthy();
});
it('shows restricted membership failure without offering excluded skills', () => {
  render(<Catalogue session={{ ...session, catalogue: [], membership: { state: 'error' } }} />);
  expect(screen.getByText(/Project memberships could not be verified/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Test Skill' })).toBeNull();
});
it('sends only the selected candidate, revision, scope and tools; README stays text', async () => {
  const onJob = vi.fn();
  const { client, fetcher } = mockApi((path) => path.startsWith('/api/catalogue') ? { entry, readme: '<script>alert("unsafe")</script>' } : { jobId: 'install-job' });
  render(<SkillDetail client={client} skillId="test-skill" session={session} context={context} jobs={[]} onJob={onJob} />);
  await screen.findByRole('heading', { name: 'Install skill' });
  expect(screen.getByText('<script>alert("unsafe")</script>').tagName).toBe('PRE');
  expect(document.querySelector('script')).toBeNull();
  await userEvent.selectOptions(screen.getByLabelText('Install scope'), 'repo');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
  await userEvent.click(screen.getByRole('button', { name: 'Install to 1 tool' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('install-job'));
  const request = fetcher.mock.calls.find(([path]) => path === '/api/installs')!;
  expect(JSON.parse(request[1]!.body as string)).toEqual({ sessionRevision: 7, skillId: 'test-skill', installKey: 'bundle/test/test-skill', scope: 'repo', repoRoot: '/example/repo', toolIds: ['claude-code'] });
});
it('manages the exact namespaced installation and confirms removal', async () => {
  const record: InstalledRecordDto = { installKey: 'bundle/test/test-skill', skillId: 'test-skill', toolId: 'claude-code', scope: 'repo', repoRoot: '/example/repo', version: '1.0.0', installedAt: '2026-01-01', method: 'symlink', linkName: 'test-skill' };
  const onJob = vi.fn();
  const onToast = vi.fn();
  const { client, fetcher } = mockApi((_path, options) => options.method === 'POST' ? { jobId: 'update-job' } : options.method === 'DELETE' ? { result: { errors: [] } } : { records: [record] });
  render(<Installed client={client} context={context} refreshKey="" onJob={onJob} onToast={onToast} />);
  await userEvent.click(await screen.findByRole('button', { name: /^Update / }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('update-job'));
  expect(fetcher.mock.calls.some(([path]) => path === '/api/installs/bundle%2Ftest%2Ftest-skill/update')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: /^Remove / }));
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true));
  const call = fetcher.mock.calls.find(([, options]) => options?.method === 'DELETE')!;
  expect(String(call[0])).toContain('scope=repo&toolId=claude-code&repoRoot=%2Fexample%2Frepo');
  expect(onToast).toHaveBeenCalledWith('Uninstall skill', 'success', expect.stringContaining('test-skill'));
});
it('reports a failed uninstall via toast and keeps the inline error visible', async () => {
  const record: InstalledRecordDto = { installKey: 'test-skill', skillId: 'test-skill', toolId: 'claude-code', scope: 'system', version: '1.0.0', installedAt: '2026-01-01', method: 'symlink', linkName: 'test-skill' };
  const onToast = vi.fn();
  const { client } = mockApi((_path, options) => options.method === 'DELETE' ? { result: { errors: [{ name: 'test-skill', error: 'File is locked' }] } } : { records: [record] });
  render(<Installed client={client} context={context} refreshKey="" onJob={vi.fn()} onToast={onToast} />);
  await userEvent.click(await screen.findByRole('button', { name: /^Remove / }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(onToast).toHaveBeenCalledWith('Uninstall skill', 'error', expect.stringContaining('File is locked')));
  expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('File is locked'))).toBe(true);
});
it('shows "Installed N skill(s)" and disables submit until a form field changes', async () => {
  const onJob = vi.fn();
  const { client } = mockApi((path) => path.startsWith('/api/catalogue') ? { entry } : { jobId: 'install-job' });
  const jobs: JobDto[] = [];
  const { rerender } = render(<SkillDetail client={client} skillId="test-skill" session={session} context={context} jobs={jobs} onJob={onJob} />);
  await screen.findByRole('heading', { name: 'Install skill' });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
  await userEvent.click(screen.getByRole('button', { name: 'Install to 1 tool' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('install-job'));
  expect(screen.getByRole('button', { name: 'Installing…' })).toBeTruthy();
  const succeeded: JobDto = { id: 'install-job', kind: 'install', state: 'succeeded', phase: 'complete', canCancel: false, progress: '', result: { result: { installed: [{ name: 'test-skill', method: 'symlink', path: '/x' }], errors: [] } } };
  rerender(<SkillDetail client={client} skillId="test-skill" session={session} context={context} jobs={[succeeded]} onJob={onJob} />);
  const done = await screen.findByRole('button', { name: 'Installed 1 skill' });
  expect((done as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
  expect(screen.getByRole('button', { name: 'Install skill' })).toBeTruthy();
});
it('adds an active source and starts a catalogue reload', async () => {
  const onJob = vi.fn();
  const { client, fetcher } = mockApi((path) => path === '/api/session/load' ? { jobId: 'load-job' } : { sources: [], active: null });
  render(<Sources client={client} onJob={onJob} />);
  await userEvent.type(screen.getByLabelText('Source URL or local directory'), 'https://skills.example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Add source' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('load-job'));
  const call = fetcher.mock.calls.find(([path, options]) => path === '/api/sources' && options?.method === 'POST')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ value: 'https://skills.example.com', activate: true });
});
it('persists settings and prevents toggling an environment-enforced preference', async () => {
  const { client, fetcher } = mockApi(() => ({ startupUpdateChecksDisabled: false, telemetryDisabled: false, envOverrides: { startupUpdateChecksDisabled: true, telemetryDisabled: false } }));
  render(<Settings client={client} />);
  const startup = await screen.findByRole('checkbox', { name: /Check for updates at startup/ });
  expect((startup as HTMLInputElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('checkbox', { name: /Share anonymous usage data/ }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true));
  const call = fetcher.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ telemetryDisabled: true });
});
it('exposes sign-in only as an explicit safe link and disables cancellation during commits', async () => {
  const { client } = mockApi(() => ({}));
  const { rerender } = render(<JobPanel client={client} onDismiss={vi.fn()} jobs={[{ id: 'one', kind: 'session-load', state: 'running', phase: 'auth', canCancel: true, progress: 'Sign in', authorizeUrl: 'https://auth.example.com/authorize' }]} />);
  expect((screen.getByRole('link', { name: /Open sign-in page/ }) as HTMLAnchorElement).rel).toContain('noopener');
  rerender(<JobPanel client={client} onDismiss={vi.fn()} jobs={[{ id: 'one', kind: 'install', state: 'running', phase: 'commit', canCancel: false, progress: 'Installing', authorizeUrl: 'javascript:alert(1)' }]} />);
  expect(screen.queryByRole('link', { name: /Open sign-in page/ })).toBeNull();
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
});

it('rolls back the displayed setting when persistence fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_path, options) => options?.method === 'PATCH'
    ? new Response(JSON.stringify({ error: { name: 'ConflictError', message: 'Another operation is running', category: 'conflict' } }), { status: 409 })
    : new Response(JSON.stringify({ startupUpdateChecksDisabled: false, telemetryDisabled: false, envOverrides: { startupUpdateChecksDisabled: false, telemetryDisabled: false } })));
  render(<Settings client={new ApiClient('test-token-value', fetcher)} />);
  const checkbox = await screen.findByRole('checkbox', { name: /Share anonymous usage data/ });
  await userEvent.click(checkbox);
  await screen.findByRole('alert');
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('Another operation');
});

it('shows one actionable alert and no loading spinner in a tab without a token', async () => {
  render(<App client={new ApiClient(null)} />);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
  expect(screen.getByRole('alert').textContent).toContain('Open the Web UI URL');
  expect(screen.queryByText('Loading your catalogue…')).toBeNull();
});
it('does not invent a trust badge and explains when repository scope is unavailable', async () => {
  const plain = { ...entry, candidates: [{ ...entry.candidates[0]!, sourceStatus: undefined }] };
  const { client } = mockApi(() => ({ entry: plain }));
  render(<SkillDetail client={client} skillId="test-skill" session={{ ...session, catalogue: [plain] }} context={{ ...context, repoRoot: null, repoName: null }} jobs={[]} onJob={vi.fn()} />);
  const option = await screen.findByRole('option', { name: 'Repository · no repository detected' });
  expect((option as HTMLOptionElement).disabled).toBe(true);
  expect(screen.queryByText(/unverified/i)).toBeNull();
});
it.each([
  ['http://localhost:8080/authorize', true], ['http://[::1]:8080/authorize', true],
  ['http://auth.example.com/authorize', false], ['http://user@localhost:8080/authorize', false],
])('renders only permitted authorization links: %s', (authorizeUrl, allowed) => {
  const { client } = mockApi(() => ({}));
  render(<JobPanel client={client} onDismiss={vi.fn()} jobs={[{ id: 'one', kind: 'session-load', state: 'running', phase: 'auth', canCancel: true, progress: '', authorizeUrl }]} />);
  expect(!!screen.queryByRole('link', { name: /Open sign-in page/ })).toBe(allowed);
});
it('focuses confirmation controls, traps Tab, and restores the trigger on Escape', async () => {
  const record: InstalledRecordDto = { installKey: 'test-skill', skillId: 'test-skill', toolId: 'claude-code', scope: 'system', version: '1.0.0', installedAt: '', method: 'symlink', linkName: 'test-skill' };
  const { client } = mockApi(() => ({ records: [record] }));
  render(<Installed client={client} context={context} refreshKey="" onJob={vi.fn()} onToast={vi.fn()} />);
  const trigger = await screen.findByRole('button', { name: /^Remove test-skill/ });
  await userEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Confirm removal' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm removal' }));
  await userEvent.tab();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
