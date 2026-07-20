import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SkillSourcePicker } from '../../../src/components/SkillSourcePicker.js';
import { buildCatalogue } from '../../../src/discovery/catalogue.js';
import type { ResolvedSkill } from '../../../src/discovery/resolver.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

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
  {
    dirName: 'my-skill',
    dirPath: '/tmp/b/my-skill',
    skillMdPath: '/tmp/b/my-skill/SKILL.md',
    meta: null,
    sourceName: 'community-cdn',
    sourceType: 'artefact',
    sourceStatus: 'community',
    sourcePin: {
      sourceType: 'artefact',
      installLayout: 'namespaced',
      artefactUrl: 'https://cdn.example.com/my-skill-1.2.0.zip',
      artefactVersion: '1.2.0',
    },
  },
];

const entry = buildCatalogue(skills)[0]!;

async function renderReady(props: { onSelect?: (c: unknown) => void; onBack?: () => void } = {}) {
  const result = render(
    <SkillSourcePicker entry={entry} onSelect={props.onSelect ?? (() => {})} onBack={props.onBack ?? (() => {})} />,
  );
  await vi.waitFor(() => {
    expect(result.lastFrame()).toContain('Choose a source:');
  });
  await flushInkInput();
  return result;
}

describe('SkillSourcePicker', () => {
  it('lists every candidate with source name, type, and trust', async () => {
    const { lastFrame } = await renderReady();

    const frame = lastFrame()!;
    expect(frame).toContain('My Skill');
    expect(frame).toContain('Does things');
    expect(frame).toContain('acme-repo');
    expect(frame).toContain('git');
    expect(frame).toContain('official');
    expect(frame).toContain('community-cdn');
    expect(frame).toContain('artefact');
    expect(frame).toContain('community');
  });

  it('shows the highlighted candidate coordinate and install key', async () => {
    const { lastFrame, stdin } = await renderReady();

    expect(lastFrame()).toContain('https://github.com/acme/skills@main');
    expect(lastFrame()).toContain('github.com/acme/skills/my-skill');

    await press(stdin, DOWN);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('https://cdn.example.com/my-skill-1.2.0.zip (1.2.0)');
    });
    expect(lastFrame()).toContain('cdn.example.com/my-skill/my-skill');
  });

  it('selects the highlighted candidate on Enter', async () => {
    const onSelect = vi.fn();
    const { stdin } = await renderReady({ onSelect });

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sourceName: 'community-cdn' }));
    });
  });

  it('invokes onBack from the back item', async () => {
    const onBack = vi.fn();
    const { stdin } = await renderReady({ onBack });

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
