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
    expect(result.lastFrame()).toContain('Browse agents and skills');
  });
  await flushInkInput();
  return result;
}

describe('SkillBrowser', () => {
  it('lists one row per skill+source with source type, trust, and source name', async () => {
    const { lastFrame } = await renderReady();

    const frame = lastFrame()!;
    expect(frame).toContain('Data Pipeline');
    expect(frame).toContain('Builds ingestion pipelines');
    expect(frame).toContain('git · official · acme-repo');
    expect(frame).toContain('artefact · community · community-cdn');
    expect(frame).not.toContain('(2 sources)');
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
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ skillId: 'web-frontend' }),
        expect.objectContaining({ sourceName: 'acme-repo' }),
      );
    });
  });

  it('shows an empty message when nothing matches', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, 'zzz');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('No skills match "zzz".');
    });
  });

  it('moves the cursor with arrows and selects the highlighted entry with its candidate', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = await renderReady({ onSelect });

    // Row 0: Data Pipeline (acme-repo, official)
    // Row 1: web-frontend (acme-repo, official)
    // Row 2: web-frontend (community-cdn, community)
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('❯ web-frontend');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ skillId: 'web-frontend' }),
        expect.objectContaining({ sourceName: 'acme-repo' }),
      );
    });
  });

  it('selects a specific source row for a multi-source skill', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = await renderReady({ onSelect });

    // Move to row 2: web-frontend from community-cdn
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    expect(lastFrame()).toContain('community-cdn');
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ skillId: 'web-frontend' }),
        expect.objectContaining({ sourceName: 'community-cdn', sourceType: 'artefact' }),
      );
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

  it('shows membership project names on the highlighted detail row', async () => {
    const annotated = buildCatalogue([
      makeSkill({
        dirName: 'shared-skill',
        sourceName: 'acme-repo',
        meta: { name: 'Shared Skill', description: 'Used by two projects' },
      }),
    ]).map((entry) => ({ ...entry, projectNames: ['Alpha', 'Beta'] }));

    const { lastFrame } = render(
      <SkillBrowser entries={annotated} onSelect={() => {}} onBack={() => {}} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Shared Skill');
    });

    expect(lastFrame()).toContain('Projects: Alpha, Beta');
    expect(lastFrame()).toContain('Used by two projects');
  });

  describe('viewport windowing', () => {
    // A frame taller than the terminal cannot be fully cleared on re-render,
    // which corrupts the display — so the list must be windowed.
    const manyEntries = buildCatalogue(
      Array.from({ length: 40 }, (_, i) =>
        makeSkill({ dirName: `skill-${String(i).padStart(2, '0')}`, sourceName: 'acme-repo' }),
      ),
    );

    it('renders only a window of a long list, with a hidden-below indicator', async () => {
      const { lastFrame } = render(
        <SkillBrowser entries={manyEntries} onSelect={() => {}} onBack={() => {}} />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('skill-00');
      });

      const frame = lastFrame()!;
      expect(frame).not.toContain('skill-39');
      expect(frame).toMatch(/↓ \d+ more/);
      expect(frame).not.toMatch(/↑ \d+ more/);
    });

    it('scrolls the window as the cursor moves down', async () => {
      const { lastFrame, stdin } = render(
        <SkillBrowser entries={manyEntries} onSelect={() => {}} onBack={() => {}} />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('skill-00');
      });
      await flushInkInput();

      for (let i = 0; i < 20; i++) {
        await press(stdin, DOWN);
      }

      const frame = lastFrame()!;
      expect(frame).toContain('❯ skill-20');
      expect(frame).toMatch(/↑ \d+ more/);
      expect(frame).not.toContain('skill-00');
    });

    it('shows the description only for the highlighted entry', async () => {
      const described = buildCatalogue([
        makeSkill({ dirName: 'first', sourceName: 'acme-repo', meta: { name: 'First', description: 'FIRST-DESC' } }),
        makeSkill({ dirName: 'second', sourceName: 'acme-repo', meta: { name: 'Second', description: 'SECOND-DESC' } }),
      ]);

      const { lastFrame, stdin } = render(
        <SkillBrowser entries={described} onSelect={() => {}} onBack={() => {}} />,
      );
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('First');
      });

      expect(lastFrame()).toContain('FIRST-DESC');
      expect(lastFrame()).not.toContain('SECOND-DESC');

      await flushInkInput();
      await press(stdin, DOWN);

      // Windows CI can lag one tick behind ink's cursor update after arrow input.
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('SECOND-DESC');
      });
      expect(lastFrame()).not.toContain('FIRST-DESC');
    });
  });
});
