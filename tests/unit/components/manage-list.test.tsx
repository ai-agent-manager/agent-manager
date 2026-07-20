import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import type { InstalledSkillRecord } from '../../../src/operations/manage.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

const records: InstalledSkillRecord[] = [
  {
    installKey: 'github.com/example-org/example-repo/my-skill',
    skillId: 'my-skill',
    toolId: 'claude-code',
    scope: 'system',
    sourcePin: {
      sourceType: 'repo',
      installLayout: 'namespaced',
      repoUrl: 'https://github.com/example-org/example-repo',
      ref: 'main',
    },
    version: 'main',
    installedAt: '2026-01-01T00:00:00.000Z',
    method: 'symlink',
    linkName: 'github.com~example-org~example-repo__my-skill',
  },
  {
    installKey: 'legacy-skill',
    skillId: 'legacy-skill',
    toolId: 'windsurf',
    scope: 'repo',
    repoRoot: '/tmp/my-repo',
    version: '0.9.0',
    installedAt: '2025-01-01T00:00:00.000Z',
    method: 'symlink',
    linkName: 'legacy-skill',
  },
];

vi.mock('../../../src/operations/manage.js', () => ({
  listInstalled: vi.fn(async () => records),
}));

const { ManageList } = await import('../../../src/components/ManageList.js');
const { listInstalled } = await import('../../../src/operations/manage.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listInstalled).mockResolvedValue(records);
});

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

describe('ManageList', () => {
  it('lists installed skills with source, scope, and tool', async () => {
    const { lastFrame } = render(<ManageList onSelect={() => {}} onBack={() => {}} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('github.com/example-org/exam');
    });
    expect(lastFrame()).toContain('repo@main');
    expect(lastFrame()).toContain('local');
    expect(lastFrame()).toContain('claude-code');
    expect(lastFrame()).toContain('bundle@0.9.0 (legacy)');
    expect(lastFrame()).toContain('windsurf');
  });

  it('selects a record on Enter', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(<ManageList onSelect={onSelect} onBack={() => {}} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('repo@main');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(records[0]);
    });
  });

  it('invokes onBack from the back item', async () => {
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<ManageList onSelect={() => {}} onBack={onBack} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('← Back');
    });
    await flushInkInput();

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('❯ ← Back');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });

  it('shows an empty state when nothing is installed', async () => {
    vi.mocked(listInstalled).mockResolvedValue([]);
    const { lastFrame } = render(<ManageList onSelect={() => {}} onBack={() => {}} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No skills installed.');
    });
  });

  it('surfaces load errors', async () => {
    vi.mocked(listInstalled).mockRejectedValue(new Error('config unreadable'));
    const { lastFrame } = render(<ManageList onSelect={() => {}} onBack={() => {}} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Error: config unreadable');
    });
  });
});
