import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DirectoryField } from './DirectoryField.js';
afterEach(() => { delete window.agentmanDesktop; });
it('keeps the browser text field and offers no native picker without a bridge', () => {
  render(<DirectoryField label="Repository root" value="" onChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Repository root' })).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
it('uses a chosen native path without submitting the enclosing form', async () => {
  const changed = vi.fn(), submitted = vi.fn();
  window.agentmanDesktop = { version: '1.0.0', pickDirectory: vi.fn(async () => '/example/repository') };
  render(<form onSubmit={submitted}><DirectoryField label="Repository root" value="" onChange={changed} /></form>);
  await userEvent.click(screen.getByRole('button', { name: 'Browse repository root' }));
  expect(changed).toHaveBeenCalledWith('/example/repository'); expect(submitted).not.toHaveBeenCalled();
});
it('preserves the typed path on cancel and allows manual entry after picker failure', async () => {
  const changed = vi.fn(), pick = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('native failure'));
  window.agentmanDesktop = { version: '1.0.0', pickDirectory: pick };
  render(<DirectoryField label="Repository root" value="/example/typed" onChange={changed} />);
  const button = screen.getByRole('button', { name: 'Browse repository root' });
  await userEvent.click(button); expect(changed).not.toHaveBeenCalled();
  await userEvent.click(button); expect(await screen.findByText(/Enter the repository path instead/)).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('/example/typed');
});
