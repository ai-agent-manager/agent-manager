import { describe, it, expect } from 'vitest';
import type { RovoAgentInfo, SkillInfo } from '../../../src/bundle/scanner.js';
import type { Project } from '../../../src/api/types.js';
import {
  normaliseProjectRestrictions,
  isAgentAllowed,
  isSkillAllowed,
  filterSkillsForProject,
  filterAgentsForProject,
} from '../../../src/api/project-restrictions.js';

function skill(dirName: string): SkillInfo {
  return {
    dirName,
    dirPath: `/tmp/${dirName}`,
    skillMdPath: `/tmp/${dirName}/SKILL.md`,
    meta: null,
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

describe('normaliseProjectRestrictions', () => {
  it('defaults missing restriction fields to unrestricted', () => {
    expect(normaliseProjectRestrictions(baseProject)).toMatchObject({
      restrictAgents: false,
      restrictSkills: false,
      allowedAgentIds: [],
      allowedSkillIds: [],
    });
  });

  it('preserves explicit restriction values', () => {
    const project = {
      ...baseProject,
      restrictAgents: true,
      restrictSkills: true,
      allowedAgentIds: ['agent-a'],
      allowedSkillIds: ['skill-a'],
    };
    expect(normaliseProjectRestrictions(project)).toMatchObject({
      restrictAgents: true,
      restrictSkills: true,
      allowedAgentIds: ['agent-a'],
      allowedSkillIds: ['skill-a'],
    });
  });

  it('treats a truthy non-boolean restrict flag as unrestricted', () => {
    const project = normaliseProjectRestrictions({
      ...baseProject,
      // @ts-expect-error — legacy payloads may send unexpected types
      restrictAgents: 'yes',
      // @ts-expect-error
      restrictSkills: 1,
    });
    expect(project.restrictAgents).toBe(false);
    expect(project.restrictSkills).toBe(false);
  });
});

describe('isAgentAllowed / isSkillAllowed', () => {
  it('allows everything when restriction is off', () => {
    expect(isAgentAllowed({ restrictAgents: false, allowedAgentIds: [] }, 'any')).toBe(true);
    expect(isSkillAllowed({ restrictSkills: false, allowedSkillIds: [] }, 'any')).toBe(true);
  });

  it('allows only listed IDs when restriction is on', () => {
    expect(
      isAgentAllowed({ restrictAgents: true, allowedAgentIds: ['a', 'b'] }, 'a'),
    ).toBe(true);
    expect(
      isAgentAllowed({ restrictAgents: true, allowedAgentIds: ['a', 'b'] }, 'c'),
    ).toBe(false);
    expect(
      isSkillAllowed({ restrictSkills: true, allowedSkillIds: [] }, 'skill'),
    ).toBe(false);
  });

  it('treats a missing allowlist as empty when restriction is on', () => {
    expect(isAgentAllowed({ restrictAgents: true }, 'agent-a')).toBe(false);
    expect(isSkillAllowed({ restrictSkills: true }, 'skill-a')).toBe(false);
  });
});

describe('filterSkillsForProject / filterAgentsForProject', () => {
  const skills = [skill('skill-a'), skill('skill-b'), skill('skill-c')];
  const agents = [agent('agent-a'), agent('agent-b')];

  it('returns the full catalogue when unrestricted', () => {
    expect(
      filterSkillsForProject(skills, { restrictSkills: false, allowedSkillIds: ['skill-a'] }),
    ).toEqual(skills);
    expect(
      filterAgentsForProject(agents, { restrictAgents: false, allowedAgentIds: [] }),
    ).toEqual(agents);
  });

  it('filters to the allowlist when restricted', () => {
    expect(
      filterSkillsForProject(skills, {
        restrictSkills: true,
        allowedSkillIds: ['skill-b', 'skill-c'],
      }).map((s) => s.dirName),
    ).toEqual(['skill-b', 'skill-c']);

    expect(
      filterAgentsForProject(agents, {
        restrictAgents: true,
        allowedAgentIds: ['agent-b'],
      }).map((a) => a.dirName),
    ).toEqual(['agent-b']);
  });
});
