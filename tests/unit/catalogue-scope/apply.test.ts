import { describe, it, expect } from 'vitest';
import type { RovoAgentInfo, SkillInfo } from '../../../src/bundle/scanner.js';
import type { Project } from '../../../src/api/types.js';
import type { ResolvedSkill } from '../../../src/discovery/resolver.js';
import {
  buildScopedCatalogue,
  partitionSkillsByScope,
  resolveCatalogueScope,
  scopeAgents,
  scopeCatalogueAssets,
  scopeSkills,
} from '../../../src/catalogue-scope/index.js';

function skill(dirName: string): SkillInfo {
  return {
    dirName,
    dirPath: `/tmp/${dirName}`,
    skillMdPath: `/tmp/${dirName}/SKILL.md`,
    meta: null,
  };
}

function resolvedSkill(dirName: string): ResolvedSkill {
  return {
    ...skill(dirName),
    sourceName: 'acme-repo',
    sourceType: 'git',
  };
}

function agent(dirName: string): RovoAgentInfo {
  return {
    dirName,
    dirPath: `/tmp/${dirName}`,
    configPath: `/tmp/${dirName}/rovo-agent.yaml`,
    config: { identity: { name: dirName } } as RovoAgentInfo['config'],
    meta: null,
    knowledgeBaseFiles: [],
  };
}

const baseProject: Project = {
  id: 'proj-1',
  teamId: 'team-1',
  name: 'Alpha',
  toolIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const alpha: Project = {
  ...baseProject,
  id: 'alpha',
  name: 'Alpha',
  restrictSkills: true,
  restrictAgents: true,
  allowedSkillIds: ['skill-a'],
  allowedAgentIds: ['agent-a'],
};

const beta: Project = {
  ...baseProject,
  id: 'beta',
  name: 'Beta',
  restrictSkills: true,
  restrictAgents: true,
  allowedSkillIds: ['skill-b'],
  allowedAgentIds: ['agent-b'],
};

const skills = [skill('skill-a'), skill('skill-b'), skill('skill-c')];
const agents = [agent('agent-a'), agent('agent-b'), agent('agent-c')];

describe('resolveCatalogueScope', () => {
  it('prefers an explicit project context over exclusiveSource', () => {
    expect(
      resolveCatalogueScope({
        projectContext: alpha,
        exclusiveSource: true,
        membershipProjects: [beta],
      }),
    ).toEqual({ kind: 'project', project: alpha });
  });

  it('uses membership when exclusiveSource is enabled', () => {
    expect(
      resolveCatalogueScope({
        exclusiveSource: true,
        membershipProjects: [alpha, beta],
      }),
    ).toEqual({ kind: 'membership', projects: [alpha, beta] });
  });

  it('treats missing membership as an empty list when exclusiveSource is on', () => {
    expect(resolveCatalogueScope({ exclusiveSource: true })).toEqual({
      kind: 'membership',
      projects: [],
    });
  });

  it('is unrestricted when exclusiveSource is off and no project is selected', () => {
    expect(resolveCatalogueScope({ exclusiveSource: false, membershipProjects: [alpha] })).toEqual({
      kind: 'unrestricted',
    });
    expect(resolveCatalogueScope({})).toEqual({ kind: 'unrestricted' });
  });
});

describe('scopeSkills / scopeAgents', () => {
  it('leaves assets unchanged when unrestricted', () => {
    const scope = { kind: 'unrestricted' as const };
    expect(scopeSkills(skills, scope)).toEqual(skills);
    expect(scopeAgents(agents, scope)).toEqual(agents);
  });

  it('filters to a single project allowlist', () => {
    const scope = { kind: 'project' as const, project: alpha };
    expect(scopeSkills(skills, scope).map((s) => s.dirName)).toEqual(['skill-a']);
    expect(scopeAgents(agents, scope).map((a) => a.dirName)).toEqual(['agent-a']);
  });

  it('unions membership allowlists for exclusiveSource', () => {
    const scope = { kind: 'membership' as const, projects: [alpha, beta] };
    expect(scopeSkills(skills, scope).map((s) => s.dirName)).toEqual(['skill-a', 'skill-b']);
    expect(scopeAgents(agents, scope).map((a) => a.dirName)).toEqual(['agent-a', 'agent-b']);
  });

  it('allows everything when any membership project is unrestricted', () => {
    const scope = {
      kind: 'membership' as const,
      projects: [alpha, { ...beta, restrictSkills: false, restrictAgents: false }],
    };
    expect(scopeSkills(skills, scope)).toEqual(skills);
    expect(scopeAgents(agents, scope)).toEqual(agents);
  });

  it('yields an empty catalogue when membership is empty', () => {
    const scope = { kind: 'membership' as const, projects: [] };
    expect(scopeSkills(skills, scope)).toEqual([]);
    expect(scopeAgents(agents, scope)).toEqual([]);
  });
});

describe('partitionSkillsByScope', () => {
  it('partitions permitted and excluded skills for membership scope', () => {
    const { permitted, excluded } = partitionSkillsByScope(skills, {
      kind: 'membership',
      projects: [alpha, beta],
    });
    expect(permitted.map((s) => s.dirName)).toEqual(['skill-a', 'skill-b']);
    expect(excluded.map((s) => s.dirName)).toEqual(['skill-c']);
  });

  it('excludes nothing when unrestricted', () => {
    expect(partitionSkillsByScope(skills, { kind: 'unrestricted' })).toEqual({
      permitted: skills,
      excluded: [],
    });
  });
});

describe('scopeCatalogueAssets / buildScopedCatalogue', () => {
  it('returns annotation projects for membership scope', () => {
    const scoped = scopeCatalogueAssets(skills, agents, {
      kind: 'membership',
      projects: [alpha, beta],
    });
    expect(scoped.annotationProjects).toEqual([alpha, beta]);
    expect(scoped.skills.map((s) => s.dirName)).toEqual(['skill-a', 'skill-b']);
  });

  it('builds Search & Install entries annotated with permitting project names', () => {
    const entries = buildScopedCatalogue(
      [resolvedSkill('skill-a'), resolvedSkill('skill-b'), resolvedSkill('skill-c')],
      [agent('agent-b')],
      { kind: 'membership', projects: [alpha, beta] },
    );

    const skillA = entries.find((e) => e.skillId === 'skill-a');
    const skillB = entries.find((e) => e.skillId === 'skill-b');
    const agentB = entries.find((e) => e.kind === 'rovo-agent' && e.skillId === 'agent-b');

    expect(entries.map((e) => e.skillId).sort()).toEqual(['agent-b', 'skill-a', 'skill-b']);
    expect(skillA?.projectNames).toEqual(['Alpha']);
    expect(skillB?.projectNames).toEqual(['Beta']);
    expect(agentB?.projectNames).toEqual(['Beta']);
  });

  it('does not annotate unrestricted catalogues', () => {
    const entries = buildScopedCatalogue(
      [resolvedSkill('skill-a')],
      [],
      { kind: 'unrestricted' },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.projectNames).toBeUndefined();
  });
});
