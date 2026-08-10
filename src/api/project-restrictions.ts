/**
 * Project agent/skill restriction helpers — aligned with the backend API
 * (`restrictAgents` / `restrictSkills` and allowlists on projects).
 *
 * Catalogue IDs are asset directory names (the same IDs the backend stores in
 * `allowedAgentIds` / `allowedSkillIds`).
 */

import type { RovoAgentInfo, SkillInfo } from '../bundle/scanner.js';
import type { CatalogueEntry } from '../discovery/catalogue.js';
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

/**
 * A catalogue item is permitted under exclusiveSource when at least one of the
 * caller's projects allows it.
 */
export function isSkillAllowedByMembership(
  projects: Array<Pick<ProjectRestrictions, 'restrictSkills' | 'allowedSkillIds'>>,
  skillId: string,
): boolean {
  return projects.some((project) => isSkillAllowed(project, skillId));
}

export function isAgentAllowedByMembership(
  projects: Array<Pick<ProjectRestrictions, 'restrictAgents' | 'allowedAgentIds'>>,
  agentId: string,
): boolean {
  return projects.some((project) => isAgentAllowed(project, agentId));
}

/** Skills permitted by any of the caller's projects (union of allowlists). */
export function filterSkillsForMembership<T extends SkillInfo>(
  skills: T[],
  projects: Array<Pick<ProjectRestrictions, 'restrictSkills' | 'allowedSkillIds'>>,
): T[] {
  return skills.filter((skill) => isSkillAllowedByMembership(projects, skill.dirName));
}

/** Agents permitted by any of the caller's projects (union of allowlists). */
export function filterAgentsForMembership(
  agents: RovoAgentInfo[],
  projects: Array<Pick<ProjectRestrictions, 'restrictAgents' | 'allowedAgentIds'>>,
): RovoAgentInfo[] {
  return agents.filter((agent) => isAgentAllowedByMembership(projects, agent.dirName));
}

/** Project names that permit a given skill or agent catalogue ID. */
export function projectNamesAllowingAsset(
  projects: Array<Pick<Project, 'name'> & ProjectRestrictions>,
  kind: 'skill' | 'rovo-agent',
  assetId: string,
): string[] {
  return projects
    .filter((project) =>
      kind === 'skill'
        ? isSkillAllowed(project, assetId)
        : isAgentAllowed(project, assetId),
    )
    .map((project) => project.name);
}

/**
 * Annotate catalogue entries with the names of membership projects that
 * permit each item (for exclusiveSource Search & Install detail rows).
 */
export function annotateCatalogueWithProjects(
  entries: CatalogueEntry[],
  projects: Array<Pick<Project, 'name'> & ProjectRestrictions>,
): CatalogueEntry[] {
  return entries.map((entry) => ({
    ...entry,
    projectNames: projectNamesAllowingAsset(projects, entry.kind, entry.skillId),
  }));
}
