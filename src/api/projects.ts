/**
 * Project API — list and fetch projects the authenticated user can access
 * via the backend REST API (`GET /projects`, `GET /projects/{projectId}`).
 */

import type { ApiAuth } from './client.js';
import { apiRequest, isApiNotFoundOrForbidden } from './client.js';
import { normaliseProjectRestrictions } from './project-restrictions.js';
import type { Project } from './types.js';

/**
 * List all projects the authenticated user has access to
 * (projects belonging to any team they are a member of).
 */
export async function listProjects(
  apiBaseUrl: string,
  auth: ApiAuth,
): Promise<Project[]> {
  const projects = await apiRequest<Project[]>(apiBaseUrl, '/projects', auth);
  return projects.map(normaliseProjectRestrictions);
}

/**
 * Fetch a single project by ID.
 * Returns `null` when the project does not exist or is not accessible (404 / 403).
 * Auth failures (401) and transient errors still throw.
 */
export async function getProject(
  apiBaseUrl: string,
  auth: ApiAuth,
  projectId: string,
): Promise<Project | null> {
  try {
    const project = await apiRequest<Project>(
      apiBaseUrl,
      `/projects/${encodeURIComponent(projectId)}`,
      auth,
    );
    return normaliseProjectRestrictions(project);
  } catch (err) {
    if (isApiNotFoundOrForbidden(err)) {
      return null;
    }
    throw err;
  }
}
