import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { SkillBrowser } from '../../../src/components/SkillBrowser.js';
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

function makeSkill(overrides: Partial<ResolvedSkill> & { dirName: string; sourceName: string }): ResolvedSkill {
  return {
    dirPath: `/tmp/skills/${overrides.dirName}`,
    skillMdPath: `/tmp/skills/${overrides.dirName}/SKILL.md`,
    meta: null,
    sourceType: 'git',
    ...overrides,
  };
}

const entries = buildCatalogue([
  makeSkill({
    dirName: 'data-pipeline',
    sourceName: 'acme-repo',
    sourceStatus: 'official',
    meta: { name: 'Data Pipeline', description: 'Builds ingestion pipelines' },
    sourcePin: { sourceType: 'repo', installLayout: 'namespaced', repoUrl: 'https://github.com/acme/skills' },
  }),
  makeSkill({
    dirName: 'web-frontend',
    sourceName: 'community-cdn',
    sourceType: 'artefact',
    sourceStatus: 'community',
    sourcePin: { sourceType: 'artefact', installLayout: 'namespaced', artefactUrl: 'https://cdn.example.com/web-frontend-1.0.0.zip' },
  }),
  makeSkill({
    dirName: 'web-frontend',
    sourceName: 'acme-repo',
    sourceStatus: 'official',
    sourcePin: { sourceType: 'repo', installLayout: 'namespaced', repoUrl: 'https://github.com/acme/skills' },
  }),
]);

async function renderReady(props: { onSelect?: (entry: unknown) => void; onBack?: () => void } = {}) {
  const result = render(
    <SkillBrowser
      entries={entries}
      onSelect={props.onSelect ?? (() => {})}
      onBack={props.onBack ?? (() => {})}
    />,
  );
  await vi.waitFor(() => {
    expect(result.lastFrame()).toContain('Browse skills');
  });
  await flushInkInput();
  return result;
}

describe('SkillBrowser', () => {
  it('lists skills with source type and trust for single-candidate entries', async () => {
    const { lastFrame } = await renderReady();

    const frame = lastFrame()!;
    expect(frame).toContain('Data Pipeline');
    expect(frame).toContain('Builds ingestion pipelines');
    expect(frame).toContain('git · official');
    expect(frame).toContain('web-frontend');
    expect(frame).toContain('(2 sources)');
  });

  it('filters as the user types and selects the match on Enter', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = await renderReady({ onSelect });

    await press(stdin, 'web');
    await vi.waitFor(() => {
      expect(lastFrame()).not.toContain('Data Pipeline');
    });
    expect(lastFrame()).toContain('web-frontend');

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ skillId: 'web-frontend' }));
    });
  });

  it('shows an empty message when nothing matches', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, 'zzz');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No skills match "zzz".');
    });
  });

  it('moves the cursor with arrows and selects the highlighted entry', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = await renderReady({ onSelect });

    await press(stdin, DOWN);
    expect(lastFrame()).toContain('❯ web-frontend');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ skillId: 'web-frontend' }));
    });
  });

  it('goes back on Escape', async () => {
    const onBack = vi.fn();
    const { stdin } = await renderReady({ onBack });

    await press(stdin, ESC);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
