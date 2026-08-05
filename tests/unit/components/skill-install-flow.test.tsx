import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { buildCatalogue, buildUnifiedCatalogue } from '../../../src/discovery/catalogue.js';
import type { ResolvedSkill } from '../../../src/discovery/resolver.js';
import type { RovoAgentInfo, RovoAgentConfig } from '../../../src/bundle/scanner.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';
const SPACE = ' ';

vi.mock('../../../src/operations/install.js', () => ({
  installResolvedSkills: vi.fn(async () => ({
    installed: [{ name: 'github.com/acme/skills/my-skill', method: 'symlink', path: '/tmp/link' }],
    errors: [],
  })),
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

const { SkillInstallFlow } = await import('../../../src/components/SkillInstallFlow.js');
const { installResolvedSkills } = await import('../../../src/operations/install.js');

const skills: ResolvedSkill[] = [
  {
    dirName: 'my-skill',
    dirPath: '/tmp/a/my-skill',
    skillMdPath: '/tmp/a/my-skill/SKILL.md',
    meta: { name: 'My Skill', description: 'Does things' },
    sourceName: 'acme-repo',
    sourceType: 'git',
    sourceStatus: 'official',
    sourcePin: {
      sourceType: 'repo',
      installLayout: 'namespaced',
      repoUrl: 'https://github.com/acme/skills',
      ref: 'main',
    },
  },
];

const entries = buildCatalogue(skills);

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(installResolvedSkills).mockResolvedValue({
    installed: [{ name: 'github.com/acme/skills/my-skill', method: 'symlink', path: '/tmp/link' }],
    errors: [],
  });
});

describe('SkillInstallFlow', () => {
  it('walks browse → scope → tool → confirm → install → result', async () => {
    const { lastFrame, stdin } = render(
      <SkillInstallFlow entries={entries} bundleVersion="1.0.0" onSelectRovoAgent={() => {}} onBack={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Browse agents and skills');
    });
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

    await press(stdin, SPACE);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Confirm install');
    });
    const confirmFrame = lastFrame()!;
    expect(confirmFrame).toContain('My Skill');
    expect(confirmFrame).toContain('acme-repo');
    expect(confirmFrame).toContain('(git)');
    expect(confirmFrame).toContain('official');
    expect(confirmFrame).toContain('https://github.com/acme/skills@main');
    expect(confirmFrame).toContain('claude-code');
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ github.com/acme/skills/my-skill');
    });

    expect(installResolvedSkills).toHaveBeenCalledWith({
      skills: [skills[0]],
      toolId: 'claude-code',
      scope: 'system',
      repoRoot: undefined,
      bundleVersion: '',
    });
  });

  it('offers to install another skill from the result screen', async () => {
    const { lastFrame, stdin } = render(
      <SkillInstallFlow entries={entries} bundleVersion="1.0.0" onSelectRovoAgent={() => {}} onBack={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Browse agents and skills');
    });
    await flushInkInput();

    for (const key of [ENTER, ENTER, SPACE, ENTER, ENTER]) {
      await press(stdin, key);
      await flushInkInput();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install another skill');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Browse agents and skills');
    });
  });

  it('surfaces install errors on the result screen', async () => {
    vi.mocked(installResolvedSkills).mockRejectedValue(new Error('disk full'));
    const { lastFrame, stdin } = render(
      <SkillInstallFlow entries={entries} bundleVersion="1.0.0" onSelectRovoAgent={() => {}} onBack={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Browse agents and skills');
    });
    await flushInkInput();

    for (const key of [ENTER, ENTER, SPACE, ENTER, ENTER]) {
      await press(stdin, key);
      await flushInkInput();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✗ disk full');
    });
  });

  it('dispatches a picked rovo agent out of the flow instead of installing', async () => {
    const rovoAgent: RovoAgentInfo = {
      dirName: 'epic-agent',
      dirPath: '/tmp/agents/epic-agent',
      configPath: '/tmp/agents/epic-agent/rovo-agent.yaml',
      config: { identity: { name: 'Epic Agent', description: 'Elaborates epics' } } as unknown as RovoAgentConfig,
      meta: null,
      knowledgeBaseFiles: [],
    };
    const rovoEntries = buildUnifiedCatalogue([], [rovoAgent]);
    const onSelectRovoAgent = vi.fn();

    const { lastFrame, stdin } = render(
      <SkillInstallFlow
        entries={rovoEntries}
        bundleVersion="1.0.0"
        onSelectRovoAgent={onSelectRovoAgent}
        onBack={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Epic Agent');
    });
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelectRovoAgent).toHaveBeenCalledWith(rovoAgent);
    });
    expect(installResolvedSkills).not.toHaveBeenCalled();
  });

  it('returns to the menu from the result screen', async () => {
    const onBack = vi.fn();
    const { lastFrame, stdin } = render(
      <SkillInstallFlow entries={entries} bundleVersion="1.0.0" onSelectRovoAgent={() => {}} onBack={onBack} />,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Browse agents and skills');
    });
    await flushInkInput();

    for (const key of [ENTER, ENTER, SPACE, ENTER, ENTER]) {
      await press(stdin, key);
      await flushInkInput();
    }
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Install another skill');
    });
    await flushInkInput();

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
