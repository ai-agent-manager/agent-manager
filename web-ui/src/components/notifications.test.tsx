import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { JobDto } from '@api-types';
import { ApiClient } from '../api/client.js';
import { ErrorMessage, Notice } from './Feedback.js';
import { JobPanel } from './JobPanel.js';

const client = new ApiClient('test-token-value');
const running: JobDto = { id: 'install-one', kind: 'install', state: 'running', phase: 'commit', progress: 'Installing Test Skill…', canCancel: false };
afterEach(() => vi.useRealTimers());

it('keeps a dismissed notice hidden on refresh and shows a new error', () => {
  const { rerender } = render(<><Notice>Could not check for updates.</Notice><ErrorMessage message="Source unavailable" /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
  rerender(<><Notice>Could not check for updates.</Notice><ErrorMessage message="Source unavailable" /></>);
  expect(screen.queryByText('Could not check for updates.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  rerender(<ErrorMessage message="A different source failed" />);
  expect(screen.getByRole('alert').textContent).toContain('A different source failed');
});

it('retains overlapping completions and dismisses only the chosen job across snapshots', () => {
  const onDismiss = vi.fn();
  const other: JobDto = { ...running, id: 'update-two', kind: 'install-update' };
  const history: JobDto = { ...running, id: 'old-job', kind: 'session-load', state: 'succeeded' };
  const { rerender } = render(<JobPanel client={client} jobs={[history, running, other]} selectedId={other.id} onDismiss={onDismiss} />);
  expect(screen.queryByRole('region', { name: 'Load catalogue' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Dismiss/ })).toBeNull();
  const completed = [{ ...running, state: 'succeeded' as const }, { ...other, state: 'succeeded' as const }];
  rerender(<JobPanel client={client} jobs={[history, ...completed]} selectedId={other.id} onDismiss={onDismiss} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Install skill notification' }));
  expect(onDismiss).toHaveBeenCalledWith(running.id);
  rerender(<JobPanel client={client} jobs={[history, ...completed.map((job) => ({ ...job }))]} selectedId={other.id} onDismiss={onDismiss} />);
  expect(screen.queryByRole('region', { name: 'Install skill' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Update skill' })).toBeTruthy();
});

it('auto-dismisses success, pausing while hovered or keyboard focused', () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  const { rerender } = render(<JobPanel client={client} jobs={[running]} onDismiss={onDismiss} />);
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.getByText('Installing Test Skill…')).toBeTruthy();
  rerender(<JobPanel client={client} jobs={[{ ...running, state: 'succeeded' }]} onDismiss={onDismiss} />);
  const toast = screen.getByRole('region', { name: 'Install skill' });
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(20_000));
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(toast);
  const close = within(toast).getByRole('button');
  fireEvent.focus(close);
  act(() => vi.advanceTimersByTime(20_000));
  expect(onDismiss).not.toHaveBeenCalled();
  fireEvent.blur(close);
  act(() => vi.advanceTimersByTime(8000));
  expect(onDismiss).toHaveBeenCalledWith(running.id);
  expect(screen.queryByRole('region', { name: 'Install skill' })).toBeNull();
});

it.each<JobDto>([
  { ...running, state: 'failed', error: { name: 'InstallError', message: 'Could not install', category: 'failed' } },
  { ...running, state: 'succeeded', result: { result: { installed: [], errors: [{ name: 'Test Skill', error: 'Tool unavailable' }] } } },
  { ...running, state: 'succeeded', result: { failures: ['Skill not in selected bundle'] } },
  { ...running, state: 'succeeded', result: { failures: [], superseded: true } },
])('keeps failures and partial success visible until explicitly dismissed: $result', (job) => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(<JobPanel client={client} jobs={[job]} selectedId={job.id} onDismiss={onDismiss} />);
  act(() => vi.advanceTimersByTime(60_000));
  expect(onDismiss).not.toHaveBeenCalled();
  expect(screen.getByRole('region', { name: 'Install skill' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss Install skill notification' }));
  expect(screen.queryByRole('region', { name: 'Install skill' })).toBeNull();
});
