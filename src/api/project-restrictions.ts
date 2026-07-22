/**
 * Project agent/skill restriction helpers — aligned with the backend API
 * (`restrictAgents` / `restrictSkills` and allowlists on projects).
 *
 * Catalogue IDs are asset directory names (the same IDs the backend stores in
 * `allowedAgentIds` / `allowedSkillIds`).
 */

import type { RovoAgentInfo, SkillInfo } from '../bundle/scanner.js';
import type { Project, ProjectRestrictions } from './types.js';

/** Ensure restriction fields exist when reading legacy API responses. */
export function normaliseProjectRestrictions(
  project: Project,
): Project & Required<ProjectRestrictions> {
  return {
    ...project,
    restrictAgents: project.restrictAgents === true,
    restrictSkills: project.restrictSkills === true,
    allowedAgentIds: project.allowedAgentIds ?? [],
    allowedSkillIds: project.allowedSkillIds ?? [],
  };
}

/** When restriction is off, every catalogue agent is allowed. */
export function isAgentAllowed(
  project: Pick<ProjectRestrictions, 'restrictAgents' | 'allowedAgentIds'>,
  agentId: string,
): boolean {
  if (project.restrictAgents !== true) return true;
  return (project.allowedAgentIds ?? []).includes(agentId);
}

/** When restriction is off, every catalogue skill is allowed. */
export function isSkillAllowed(
  project: Pick<ProjectRestrictions, 'restrictSkills' | 'allowedSkillIds'>,
  skillId: string,
): boolean {
  if (project.restrictSkills !== true) return true;
  return (project.allowedSkillIds ?? []).includes(skillId);
}

/** Filter resolved skills using the project's skill allowlist. */
export function filterSkillsForProject<T extends SkillInfo>(
  skills: T[],
  project: Pick<ProjectRestrictions, 'restrictSkills' | 'allowedSkillIds'>,
): T[] {
  return skills.filter((skill) => isSkillAllowed(project, skill.dirName));
}

/** Filter resolved Rovo agents using the project's agent allowlist. */
export function filterAgentsForProject(
  agents: RovoAgentInfo[],
  project: Pick<ProjectRestrictions, 'restrictAgents' | 'allowedAgentIds'>,
): RovoAgentInfo[] {
  return agents.filter((agent) => isAgentAllowed(project, agent.dirName));
}
