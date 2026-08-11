/**
 * Catalogue scoping — constrains which skills/agents appear for install surfaces
 * (Search & Install, Bulk Sync, headless) based on project context or membership.
 *
 * Call sites should resolve a {@link CatalogueScope} once, then apply it via the
 * helpers here, rather than re-implementing allowlist filters inline.
 */

import type { RovoAgentInfo, SkillInfo } from '../bundle/scanner.js';
import type { Project } from '../api/types.js';
import {
  isAgentAllowed,
  isSkillAllowed,
  filterAgentsForProject,
  filterSkillsForProject,
} from '../api/project-restrictions.js';
import {
  buildUnifiedCatalogue,
  type CatalogueEntry,
} from '../discovery/catalogue.js';
import type { ResolvedSkill } from '../discovery/resolver.js';

/** How the catalogue should be constrained for a given surface. */
export type CatalogueScope =
  | { kind: 'unrestricted' }
  | { kind: 'project'; project: Project }
  | { kind: 'membership'; projects: readonly Project[] };

export interface ScopedAssets<TSkill extends SkillInfo = SkillInfo> {
  skills: TSkill[];
  agents: RovoAgentInfo[];
  /** Projects whose names annotate catalogue rows; empty when unrestricted. */
  annotationProjects: readonly Project[];
}

export interface SkillPartition<TSkill extends SkillInfo = SkillInfo> {
  permitted: TSkill[];
  excluded: TSkill[];
}

/**
 * Prefer an explicit My Projects selection; otherwise apply exclusiveSource
 * membership when enabled; otherwise leave the catalogue unrestricted.
 */
export function resolveCatalogueScope(input: {
  projectContext?: Project | null;
  exclusiveSource?: boolean;
  membershipProjects?: readonly Project[] | null;
}): CatalogueScope {
  if (input.projectContext) {
    return { kind: 'project', project: input.projectContext };
  }
  if (input.exclusiveSource) {
    return { kind: 'membership', projects: input.membershipProjects ?? [] };
  }
  return { kind: 'unrestricted' };
}

function isSkillPermitted(scope: CatalogueScope, skillId: string): boolean {
  switch (scope.kind) {
    case 'unrestricted':
      return true;
    case 'project':
      return isSkillAllowed(scope.project, skillId);
    case 'membership':
      return scope.projects.some((project) => isSkillAllowed(project, skillId));
  }
}

function isAgentPermitted(scope: CatalogueScope, agentId: string): boolean {
  switch (scope.kind) {
    case 'unrestricted':
      return true;
    case 'project':
      return isAgentAllowed(scope.project, agentId);
    case 'membership':
      return scope.projects.some((project) => isAgentAllowed(project, agentId));
  }
}

function annotationProjectsFor(scope: CatalogueScope): readonly Project[] {
  switch (scope.kind) {
    case 'unrestricted':
      return [];
    case 'project':
      return [scope.project];
    case 'membership':
      return scope.projects;
  }
}

/** Skills permitted under the given scope. */
export function scopeSkills<TSkill extends SkillInfo>(
  skills: readonly TSkill[],
  scope: CatalogueScope,
): TSkill[] {
  if (scope.kind === 'unrestricted') {
    return [...skills];
  }
  if (scope.kind === 'project') {
    return filterSkillsForProject([...skills], scope.project);
  }
  return skills.filter((skill) => isSkillPermitted(scope, skill.dirName));
}

/** Rovo agents permitted under the given scope. */
export function scopeAgents(
  agents: readonly RovoAgentInfo[],
  scope: CatalogueScope,
): RovoAgentInfo[] {
  if (scope.kind === 'unrestricted') {
    return [...agents];
  }
  if (scope.kind === 'project') {
    return filterAgentsForProject([...agents], scope.project);
  }
  return agents.filter((agent) => isAgentPermitted(scope, agent.dirName));
}

/**
 * Partition skills into permitted vs excluded. Useful for headless logging and
 * hard-fail messaging when exclusiveSource rejects requested skills.
 */
export function partitionSkillsByScope<TSkill extends SkillInfo>(
  skills: readonly TSkill[],
  scope: CatalogueScope,
): SkillPartition<TSkill> {
  if (scope.kind === 'unrestricted') {
    return { permitted: [...skills], excluded: [] };
  }

  const permitted: TSkill[] = [];
  const excluded: TSkill[] = [];
  for (const skill of skills) {
    if (isSkillPermitted(scope, skill.dirName)) {
      permitted.push(skill);
    } else {
      excluded.push(skill);
    }
  }
  return { permitted, excluded };
}

/** Filter skills and agents together, with projects used for row annotation. */
export function scopeCatalogueAssets<TSkill extends SkillInfo>(
  skills: readonly TSkill[],
  agents: readonly RovoAgentInfo[],
  scope: CatalogueScope,
): ScopedAssets<TSkill> {
  return {
    skills: scopeSkills(skills, scope),
    agents: scopeAgents(agents, scope),
    annotationProjects: annotationProjectsFor(scope),
  };
}

function projectNamesAllowingAsset(
  projects: readonly Project[],
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

function annotateCatalogueWithProjects(
  entries: CatalogueEntry[],
  projects: readonly Project[],
): CatalogueEntry[] {
  if (projects.length === 0) {
    return entries;
  }
  return entries.map((entry) => ({
    ...entry,
    projectNames: projectNamesAllowingAsset(projects, entry.kind, entry.skillId),
  }));
}

/**
 * Build the Search & Install catalogue for a scope, annotating rows with
 * permitting project names when the scope is project- or membership-based.
 */
export function buildScopedCatalogue(
  skills: readonly ResolvedSkill[],
  agents: readonly RovoAgentInfo[],
  scope: CatalogueScope,
): CatalogueEntry[] {
  const { skills: scopedSkills, agents: scopedAgents, annotationProjects } =
    scopeCatalogueAssets(skills, agents, scope);
  const entries = buildUnifiedCatalogue(scopedSkills, scopedAgents);
  return annotateCatalogueWithProjects(entries, annotationProjects);
}
