import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BundleDto, ContextDto, InstalledRecordDto, SessionDto } from '@api-types';
import { ApiClient } from '../api/client.js';
import { Versions } from './Versions.js';
import { SkillVersions } from './SkillVersions.js';
import { JobPanel } from '../components/JobPanel.js';

const context: ContextDto = { appVersion: '0.0.0', platform: 'linux', cwd: '/example/repo', repoRoot: '/example/repo', repoName: 'repo', tools: [{ id: 'claude-code', name: 'Claude Code' }] };
const session: SessionDto = { state: 'ready', sessionRevision: 7, auth: { required: false, authenticated: false }, membership: { state: 'not-required' }, catalogue: [], warnings: [], startupNotices: [] };
const bundle: BundleDto = { bundleId: 'a'.repeat(64), version: '2.0.0', published: '2026-01-01', source: { type: 'url', value: 'https://skills.example.com' }, isCurrent: false, canSelect: true, cacheKind: 'flat' };
function api(handler: (path: string, options: RequestInit) => unknown) {
  const fetcher = vi.fn(async (path: RequestInfo | URL, options: RequestInit = {}) => new Response(JSON.stringify(handler(String(path), options))));
  return { client: new ApiClient('example-token-for-test', fetcher), fetcher };
}
it('confirms bundle selection and sends the opaque identity, revision and explicit sync scope', async () => {
  const onJob = vi.fn();
  const { client, fetcher } = api((_path, options) => options.method === 'POST' ? { jobId: 'select-job' } : { cached: [bundle], current: '1.0.0', canBrowseRemote: true });
  render(<Versions client={client} session={session} context={context} refreshKey="" onJob={onJob} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Use version 2.0.0' }));
  expect(screen.getByRole('dialog', { name: 'Select bundle version' })).toBeTruthy();
  expect(fetcher.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  await userEvent.click(screen.getByRole('checkbox', { name: /Also sync/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm version' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('select-job'));
  const call = fetcher.mock.calls.find(([path]) => path === '/api/bundles/current')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ sessionRevision: 7, bundleId: bundle.bundleId, syncInstalled: true, repoRoot: '/example/repo' });
});
it('shows unsupported cache reasons and downloads an observed remote ID without activating it', async () => {
  const onJob = vi.fn();
  const { client, fetcher } = api((path, options) => options.method === 'POST' ? { jobId: 'download-job' } : path === '/api/bundles/remote' ? { bundles: [{ ...bundle, source: { ...bundle.source, name: 'named' } }], sessionRevision: 7 } : { cached: [{ ...bundle, canSelect: false, reason: 'Select this source per installed skill.' }], current: null, canBrowseRemote: true });
  render(<Versions client={client} session={session} context={context} refreshKey="" onJob={onJob} />);
  expect((await screen.findByRole('button', { name: 'Use version 2.0.0' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Select this source per installed skill.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Browse remote versions' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Download 2.0.0 from named' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('download-job'));
  const call = fetcher.mock.calls.find(([path]) => path === '/api/bundles/download')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ sessionRevision: 7, bundleId: bundle.bundleId });
  expect(fetcher.mock.calls.some(([path]) => path === '/api/bundles/current')).toBe(false);
});
it('preserves namespaced skill identity and repository root on both read and write', async () => {
  const record: InstalledRecordDto = { installKey: 'bundle/named/test-skill', skillId: 'test-skill', toolId: 'claude-code', scope: 'repo', repoRoot: '/example/repo', version: '1.0.0', installedAt: '', method: 'symlink', linkName: 'test-skill' };
  const onJob = vi.fn();
  const { client, fetcher } = api((path, options) => options.method === 'PUT' ? { jobId: 'version-job' } : path.includes('/available') ? { bundles: [bundle], supported: true } : { instances: [record] });
  render(<SkillVersions client={client} session={session} context={context} refreshKey="" onJob={onJob} />);
  const select = await screen.findByLabelText('Installation');
  const option = await screen.findByRole('option', { name: /test-skill · claude-code/ });
  await userEvent.selectOptions(select, option);
  await userEvent.click(await screen.findByRole('button', { name: 'Use version 2.0.0' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm version' }));
  await waitFor(() => expect(onJob).toHaveBeenCalledWith('version-job'));
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/bundle%2Fnamed%2Ftest-skill/available?toolId=claude-code&scope=repo&repoRoot=%2Fexample%2Frepo'))).toBe(true);
  const call = fetcher.mock.calls.find(([, options]) => options?.method === 'PUT')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ sessionRevision: 7, bundleId: bundle.bundleId, toolId: 'claude-code', installKey: record.installKey, scope: 'repo', repoRoot: '/example/repo' });
});
it('shows partial sync failures even when bundle selection succeeded', () => {
  const { client } = api(() => ({}));
  render(<JobPanel client={client} jobs={[{ id: 'select', kind: 'bundle-select', state: 'succeeded', phase: 'complete', progress: '', canCancel: false, result: { failures: ['cursor/test-skill: unavailable in this version'] } }]} selectedId="select" onDismiss={vi.fn()} />);
  expect(screen.getByText('Bundle selected with sync failures')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('cursor/test-skill');
});

it('explains a superseded selection even when its install sync completed successfully', () => {
  const { client } = api(() => ({}));
  render(<JobPanel client={client} jobs={[{ id: 'select', kind: 'bundle-select', state: 'succeeded', phase: 'complete', progress: '', canCancel: false, result: { failures: [], superseded: true } }]} selectedId="select" onDismiss={vi.fn()} />);
  expect(screen.getByText(/newer catalogue load superseded/)).toBeTruthy();
});
it('protects live caches and allows an unused legacy cache to be removed with its removal ID', async () => {
  const { client, fetcher } = api(() => ({ cached: [
    { ...bundle, canRemove: false, removalId: bundle.bundleId, removalReason: 'This bundle serves the live catalogue.' },
    { ...bundle, version: 'legacy', bundleId: undefined, canSelect: false, canRemove: true, removalId: 'b'.repeat(64), reason: 'Origin is not verified.' },
  ], current: null, canBrowseRemote: false }));
  render(<Versions client={client} session={session} context={context} refreshKey="" onJob={vi.fn()} />);
  expect((await screen.findByRole('button', { name: 'Remove version 2.0.0' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Use version legacy' }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Remove version legacy' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path, options]) => path === `/api/bundles/${'b'.repeat(64)}` && options?.method === 'DELETE')).toBe(true));
});
it('clearing the optional repository submits a personal-only sync', async () => {
  const { client, fetcher } = api((_path, options) => options.method === 'POST' ? { jobId: 'select-job' } : { cached: [bundle], current: '1.0.0', canBrowseRemote: false });
  render(<Versions client={client} session={session} context={context} refreshKey="" onJob={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Use version 2.0.0' }));
  await userEvent.click(screen.getByRole('checkbox', { name: /Also sync/ }));
  await userEvent.clear(screen.getByRole('textbox', { name: 'Repository to include (optional)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm version' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => path === '/api/bundles/current')).toBe(true));
  const call = fetcher.mock.calls.find(([path]) => path === '/api/bundles/current')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ sessionRevision: 7, bundleId: bundle.bundleId, syncInstalled: true });
});
