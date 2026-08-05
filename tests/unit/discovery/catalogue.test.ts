import { describe, it, expect } from 'vitest';
import {
  buildCatalogue,
  buildRovoCatalogue,
  buildUnifiedCatalogue,
  filterCatalogue,
} from '../../../src/discovery/catalogue.js';
import type { ResolvedSkill } from '../../../src/discovery/resolver.js';
import type { SourceStatus, SourceType } from '../../../src/discovery/types.js';
import type { SkillSourcePin } from '../../../src/bundle/skill-source.js';
import type { RovoAgentInfo, RovoAgentConfig } from '../../../src/bundle/scanner.js';

function makeRovoAgent(overrides: { dirName: string; name?: string; description?: string }): RovoAgentInfo {
  const { dirName, name, description } = overrides;
  return {
    dirName,
    dirPath: `/tmp/agents/${dirName}`,
    configPath: `/tmp/agents/${dirName}/rovo-agent.yaml`,
    config: { identity: { name: name ?? '', description: description ?? '' } } as unknown as RovoAgentConfig,
    meta: null,
    knowledgeBaseFiles: [],
  };
}

function makeSkill(overrides: {
  dirName: string;
  sourceName: string;
  sourceType?: SourceType;
  sourceStatus?: SourceStatus;
  sourcePin?: SkillSourcePin;
  metaName?: string;
  metaDescription?: string;
}): ResolvedSkill {
  const { dirName, sourceName, sourceType, sourceStatus, sourcePin, metaName, metaDescription } = overrides;
  return {
    dirName,
    dirPath: `/tmp/skills/${dirName}`,
    skillMdPath: `/tmp/skills/${dirName}/SKILL.md`,
    meta: metaName ? { name: metaName, description: metaDescription ?? '' } : null,
    sourceName,
    sourceType: sourceType ?? 'git',
    ...(sourceStatus ? { sourceStatus } : {}),
    ...(sourcePin ? { sourcePin } : {}),
  };
}

const repoPin: SkillSourcePin = {
  sourceType: 'repo',
  installLayout: 'namespaced',
  repoUrl: 'https://github.com/example-org/example-repo',
  ref: 'main',
};

const artefactPin: SkillSourcePin = {
  sourceType: 'artefact',
  installLayout: 'namespaced',
  artefactUrl: 'https://cdn.example.com/my-skill-1.2.0.zip',
  artefactVersion: '1.2.0',
};

const bundlePin: SkillSourcePin = {
  sourceType: 'bundle',
  installLayout: 'flat',
  bundleBaseUrl: 'https://bundles.example.com',
  bundleVersion: '1.0.0',
};

describe('buildCatalogue', () => {
  it('groups same-dirName skills from different sources into one entry', () => {
    const entries = buildCatalogue([
      makeSkill({ dirName: 'my-skill', sourceName: 'repo-a', sourcePin: repoPin }),
      makeSkill({ dirName: 'my-skill', sourceName: 'artefact-b', sourceType: 'artefact', sourcePin: artefactPin }),
      makeSkill({ dirName: 'other-skill', sourceName: 'repo-a', sourcePin: repoPin }),
    ]);

    expect(entries).toHaveLength(2);
    const mySkill = entries.find((e) => e.skillId === 'my-skill')!;
    expect(mySkill.candidates).toHaveLength(2);
    expect(mySkill.candidates.map((c) => c.sourceName)).toEqual(['repo-a', 'artefact-b']);
  });

  it('orders candidates official → community → unlabeled', () => {
    const entries = buildCatalogue([
      makeSkill({ dirName: 'my-skill', sourceName: 'unlabeled', sourcePin: repoPin }),
      makeSkill({ dirName: 'my-skill', sourceName: 'community-src', sourceStatus: 'community', sourcePin: artefactPin }),
      makeSkill({ dirName: 'my-skill', sourceName: 'official-src', sourceStatus: 'official', sourcePin: bundlePin }),
    ]);

    expect(entries[0]!.candidates.map((c) => c.sourceName)).toEqual([
      'official-src',
      'community-src',
      'unlabeled',
    ]);
  });

  it('preserves source order among candidates with equal status', () => {
    const entries = buildCatalogue([
      makeSkill({ dirName: 'my-skill', sourceName: 'first', sourceStatus: 'community', sourcePin: repoPin }),
      makeSkill({ dirName: 'my-skill', sourceName: 'second', sourceStatus: 'community', sourcePin: artefactPin }),
    ]);

    expect(entries[0]!.candidates.map((c) => c.sourceName)).toEqual(['first', 'second']);
  });

  it('derives namespaced install keys for repo and artefact candidates', () => {
    const entries = buildCatalogue([
      makeSkill({ dirName: 'my-skill', sourceName: 'repo-a', sourcePin: repoPin }),
      makeSkill({ dirName: 'my-skill', sourceName: 'artefact-b', sourceType: 'artefact', sourcePin: artefactPin }),
    ]);

    const keys = entries[0]!.candidates.map((c) => c.installKey);
    expect(keys[0]).toBe('github.com/example-org/example-repo/my-skill');
    expect(keys[1]).toBe('cdn.example.com/my-skill/my-skill');
  });

  it('derives a bare install key for flat bundle candidates', () => {
    const entries = buildCatalogue([
      makeSkill({ dirName: 'my-skill', sourceName: 'bundle', sourceType: 'http', sourcePin: bundlePin }),
    ]);

    expect(entries[0]!.candidates[0]!.installKey).toBe('my-skill');
  });

  it('uses frontmatter name and description when present, dirName otherwise', () => {
    const entries = buildCatalogue([
      makeSkill({
        dirName: 'my-skill',
        sourceName: 'repo-a',
        sourcePin: repoPin,
        metaName: 'My Fancy Skill',
        metaDescription: 'Does fancy things',
      }),
      makeSkill({ dirName: 'plain-skill', sourceName: 'repo-a', sourcePin: repoPin }),
    ]);

    expect(entries[0]!.displayName).toBe('My Fancy Skill');
    expect(entries[0]!.description).toBe('Does fancy things');
    expect(entries[1]!.displayName).toBe('plain-skill');
    expect(entries[1]!.description).toBe('');
  });

  it('returns an empty catalogue for no skills', () => {
    expect(buildCatalogue([])).toEqual([]);
  });

  it('tags every skill entry with kind "skill"', () => {
    const entries = buildCatalogue([makeSkill({ dirName: 'my-skill', sourceName: 'repo-a', sourcePin: repoPin })]);
    expect(entries[0]!.kind).toBe('skill');
  });
});

describe('buildRovoCatalogue', () => {
  it('maps agents to entries using identity name and description', () => {
    const entries = buildRovoCatalogue([
      makeRovoAgent({ dirName: 'epic-agent', name: 'Epic Agent', description: 'Elaborates epics' }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('rovo-agent');
    expect(entries[0]!.skillId).toBe('epic-agent');
    expect(entries[0]!.displayName).toBe('Epic Agent');
    expect(entries[0]!.description).toBe('Elaborates epics');
    expect(entries[0]!.agent.dirName).toBe('epic-agent');
  });

  it('falls back to dirName when the identity name is empty', () => {
    const entries = buildRovoCatalogue([makeRovoAgent({ dirName: 'bare-agent' })]);
    expect(entries[0]!.displayName).toBe('bare-agent');
  });
});

describe('buildUnifiedCatalogue', () => {
  it('lists skills and rovo agents together, each tagged by kind', () => {
    const entries = buildUnifiedCatalogue(
      [makeSkill({ dirName: 'my-skill', sourceName: 'repo-a', sourcePin: repoPin })],
      [makeRovoAgent({ dirName: 'my-agent', name: 'My Agent' })],
    );

    expect(entries.map((e) => e.kind)).toEqual(['skill', 'rovo-agent']);
  });

  it('keeps a skill and an agent that share a dirName as separate entries', () => {
    const entries = buildUnifiedCatalogue(
      [makeSkill({ dirName: 'shared-name', sourceName: 'repo-a', sourcePin: repoPin })],
      [makeRovoAgent({ dirName: 'shared-name', name: 'Shared Agent' })],
    );

    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.skillId === 'shared-name').map((e) => e.kind)).toEqual(['skill', 'rovo-agent']);
  });
});

describe('filterCatalogue', () => {
  const entries = buildCatalogue([
    makeSkill({
      dirName: 'data-pipeline',
      sourceName: 'acme-repo',
      sourcePin: repoPin,
      metaName: 'Data Pipeline',
      metaDescription: 'Builds ingestion pipelines',
    }),
    makeSkill({ dirName: 'web-frontend', sourceName: 'community-cdn', sourceType: 'artefact', sourcePin: artefactPin }),
  ]);

  it('returns all entries for an empty or whitespace query', () => {
    expect(filterCatalogue(entries, '')).toHaveLength(2);
    expect(filterCatalogue(entries, '   ')).toHaveLength(2);
  });

  it('matches case-insensitively on display name', () => {
    const result = filterCatalogue(entries, 'DATA pipe');
    expect(result).toHaveLength(1);
    expect(result[0]!.skillId).toBe('data-pipeline');
  });

  it('matches on skillId, description, and source name', () => {
    expect(filterCatalogue(entries, 'web-front')[0]!.skillId).toBe('web-frontend');
    expect(filterCatalogue(entries, 'ingestion')[0]!.skillId).toBe('data-pipeline');
    expect(filterCatalogue(entries, 'community-cdn')[0]!.skillId).toBe('web-frontend');
  });

  it('returns no entries when nothing matches', () => {
    expect(filterCatalogue(entries, 'nonexistent')).toHaveLength(0);
  });

  it('matches rovo agent entries by name and description', () => {
    const unified = buildUnifiedCatalogue(
      [makeSkill({ dirName: 'data-pipeline', sourceName: 'acme-repo', sourcePin: repoPin })],
      [makeRovoAgent({ dirName: 'epic-agent', name: 'Epic Agent', description: 'Elaborates epics' })],
    );

    expect(filterCatalogue(unified, 'epic')[0]!.skillId).toBe('epic-agent');
    expect(filterCatalogue(unified, 'elaborates')[0]!.skillId).toBe('epic-agent');
    expect(filterCatalogue(unified, 'pipeline')[0]!.skillId).toBe('data-pipeline');
  });
});
