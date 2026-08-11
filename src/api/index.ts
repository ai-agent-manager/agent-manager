export { apiRequest, normaliseApiBaseUrl, resolveApiBaseUrl, isProjectsFeatureEnabled, isProjectsExclusiveSource, canAccessMyProjects, ApiError } from './client.js';
export type { ApiAuth } from './client.js';
export { listProjects, getProject } from './projects.js';
export {
  normaliseProjectRestrictions,
  isAgentAllowed,
  isSkillAllowed,
  filterSkillsForProject,
  filterAgentsForProject,
} from './project-restrictions.js';
export type { Project, ProjectRestrictions } from './types.js';
