import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { InfoView } from '../../../src/components/InfoView.js';
import type { InstalledSkillRecord } from '../../../src/operations/manage.js';

const repoRecord: InstalledSkillRecord = {
  installKey: 'github.com/example-org/example-repo/my-skill',
  skillId: 'my-skill',
  toolId: 'claude-code',
  scope: 'system',
  sourcePin: {
    sourceType: 'repo',
    installLayout: 'namespaced',
    repoUrl: 'https://github.com/example-org/example-repo',
    ref: 'v2.0',
  },
  version: 'v2.0',
  installedAt: '2026-01-01T00:00:00.000Z',
  method: 'symlink',
  linkName: 'github.com~example-org~example-repo__my-skill',
};

const legacyRecord: InstalledSkillRecord = {
  installKey: 'legacy-skill',
  skillId: 'legacy-skill',
  toolId: 'windsurf',
  scope: 'repo',
  repoRoot: '/tmp/my-repo',
  version: '0.9.0',
  installedAt: '2025-01-01T00:00:00.000Z',
  method: 'copy',
  linkName: 'legacy-skill',
};

describe('InfoView', () => {
  it('shows the full source pin for a namespaced install', () => {
    const { lastFrame } = render(<InfoView record={repoRecord} onBack={() => {}} />);

    const frame = lastFrame()!;
    expect(frame).toContain('github.com/example-org/example-repo/my-skill');
    expect(frame).toContain('claude-code');
    expect(frame).toContain('local');
    expect(frame).toContain('github.com~example-org~example-repo__my-skill');
    expect(frame).toContain('repo');
    expect(frame).toContain('namespaced');
    expect(frame).toContain('https://github.com/example-org/example-repo');
    expect(frame).toContain('v2.0');
  });

  it('shows a legacy bundle section when no pin is recorded', () => {
    const { lastFrame } = render(<InfoView record={legacyRecord} onBack={() => {}} />);

    const frame = lastFrame()!;
    expect(frame).toContain('bundle (legacy)');
    expect(frame).toContain('0.9.0');
    expect(frame).toContain('/tmp/my-repo');
  });

  it('goes back on Escape', async () => {
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(<InfoView record={repoRecord} onBack={onBack} />);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Skill info');
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    stdin.write('\u001B');
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
