import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import type { SkillInfo } from '../../../src/bundle/scanner.js';
import type { AcquireResult } from '../../../src/operations/install.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

const repoSkills: SkillInfo[] = [
  {
    dirName: 'skill-a',
    dirPath: '/tmp/repo/skills/skill-a',
    skillMdPath: '/tmp/repo/skills/skill-a/SKILL.md',
    meta: { name: 'Skill A', description: 'First skill' },
  },
  {
    dirName: 'skill-b',
    dirPath: '/tmp/repo/skills/skill-b',
    skillMdPath: '/tmp/repo/skills/skill-b/SKILL.md',
    meta: null,
  },
];

const acquireResult: AcquireResult = {
  skills: repoSkills,
  bundleVersion: '',
  sourcePin: {
    sourceType: 'repo',
    installLayout: 'namespaced',
    repoUrl: 'https://github.com/acme/skills',
    ref: 'main',
  },
};

const mockProvisioner = {
  install: vi.fn(async () => ({
    installed: [{ name: 'github.com/acme/skills/skill-a', method: 'symlink' as const, path: '/tmp/link' }],
    errors: [],
  })),
  uninstall: vi.fn(async () => ({ removed: [], errors: [] })),
  getInstalled: vi.fn(async () => []),
};

vi.mock('../../../src/operations/install.js', () => ({
  acquireSource: vi.fn(async () => acquireResult),
}));

vi.mock('../../../src/provisioners/registry.js', () => ({
  createSkillProvisioner: vi.fn(() => mockProvisioner),
}));

vi.mock('../../../src/lib/repo.js', () => ({
  findRepoRoot: vi.fn(async () => null),
  getRepoName: vi.fn(async () => null),
}));

vi.mock('../../../src/bundle/repo-config.js', () => ({
  readRepoConfig: vi.fn(async () => null),
}));

vi.mock('../../../src/config/tools.js', () => ({
  getSkillTools: vi.fn(() => [
    {
      id: 'claude-code',
      name: 'Claude Code',
      getSkillsDir: () => '/home/user/.claude/skills',
      getRepoSkillsDir: (root: string) => `${root}/.claude/skills`,
    },
  ]),
}));

vi.mock('../../../src/telemetry.js', () => ({
  trackTelemetryError: vi.fn(),
  trackTelemetryEvent: vi.fn(),
}));

const { UrlInstallFlow } = await import('../../../src/components/UrlInstallFlow.js');
const { acquireSource } = await import('../../../src/operations/install.js');
const { createSkillProvisioner } = await import('../../../src/provisioners/registry.js');

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

async function type(stdin: Stdin, text: string): Promise<void> {
  for (const char of text) {
    stdin.write(char);
    await flushInkInput();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(acquireSource).mockResolvedValue(acquireResult);
  mockProvisioner.install.mockResolvedValue({
    installed: [{ name: 'github.com/acme/skills/skill-a', method: 'symlink', path: '/tmp/link' }],
    errors: [],
  });
});

async function renderReady(props: { onBack?: () => void } = {}) {
  const result = render(<UrlInstallFlow onBack={props.onBack ?? (() => {})} />);
  await vi.waitFor(() => {
    expect(result.lastFrame()).toContain('Install from URL — select source type:');
  });
  await flushInkInput();
  return result;
}

describe('UrlInstallFlow', () => {
  it('walks repo URL → acquire → picker → scope → tool → confirm → install', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install from GitHub repository');
    });

    await type(stdin, 'https://github.com/acme/skills');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Branch/tag/SHA');
    });
    await press(stdin, ENTER);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Select skills to install:');
    });
    expect(acquireSource).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'repo', repoUrl: 'https://github.com/acme/skills' }),
    );
    expect(lastFrame()).toContain('Skill A');
    expect(lastFrame()).toContain('skill-b');
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Where do you want to install skills?');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Which tool do you want to install skills for?');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Confirm install');
    });
    const confirmFrame = lastFrame()!;
    expect(confirmFrame).toContain('(repo)');
    expect(confirmFrame).toContain('github.com/acme/skills/skill-a');
    expect(confirmFrame).toContain('github.com/acme/skills/skill-b');
    expect(confirmFrame).toContain('claude-code');
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ github.com/acme/skills/skill-a');
    });

    expect(createSkillProvisioner).toHaveBeenCalledWith('claude-code', 'system', null);
    expect(mockProvisioner.install).toHaveBeenCalledWith(repoSkills, '', acquireResult.sourcePin);
  });

  it('deselects a skill with Space before installing', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install from GitHub repository');
    });
    await type(stdin, 'https://github.com/acme/skills');
    await press(stdin, ENTER);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Select skills to install:');
    });
    await flushInkInput();

    await press(stdin, DOWN);
    await press(stdin, ' ');
    expect(lastFrame()).toContain('[ ] skill-b');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Where do you want to install skills?');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Which tool');
    });
    await flushInkInput();
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Confirm install');
    });
    expect(lastFrame()).not.toContain('skill-b');
  });

  it('shows a validation error for a non-zip artefact URL', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install from artefact zip');
    });

    await type(stdin, 'https://cdn.example.com/not-a-zip');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Artefact URL must end with .zip');
    });
    expect(acquireSource).not.toHaveBeenCalled();
  });

  it('returns to coords with an error when acquisition fails', async () => {
    vi.mocked(acquireSource).mockRejectedValue(new Error('repo archive download failed (404)'));
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install from GitHub repository');
    });
    await type(stdin, 'https://github.com/acme/missing');
    await press(stdin, ENTER);
    await press(stdin, ENTER);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('repo archive download failed (404)');
    });
    expect(lastFrame()).toContain('Install from GitHub repository');
  });

  it('rejects a URL that does not resolve to the chosen source type', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install from GitHub repository');
    });
    await type(stdin, 'https://bundles.example.com');
    await press(stdin, ENTER);
    await press(stdin, ENTER);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Not a repo source');
    });
    expect(acquireSource).not.toHaveBeenCalled();
  });

  it('invokes onBack from the source-type menu', async () => {
    const onBack = vi.fn();
    const { stdin } = await renderReady({ onBack });

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
