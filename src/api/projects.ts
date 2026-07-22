/**
 * Project API — list and fetch projects the authenticated user can access
 * via the backend REST API (`GET /projects`, `GET /projects/{projectId}`).
 */

import { apiRequest, ApiError } from './client.js';
import { normaliseProjectRestrictions } from './project-restrictions.js';
import type { Project } from './types.js';

/**
 * List all projects the authenticated user has access to
 * (projects belonging to any team they are a member of).
 */
export async function listProjects(
  apiBaseUrl: string,
  bearerToken: string,
): Promise<Project[]> {
  const projects = await apiRequest<Project[]>(apiBaseUrl, '/projects', bearerToken);
  return projects.map(normaliseProjectRestrictions);
}

/**
 * Fetch a single project by ID.
 * Returns `null` when the project does not exist or is not accessible (404).
 */
export async function getProject(
  apiBaseUrl: string,
  bearerToken: string,
  projectId: string,
): Promise<Project | null> {
  try {
    const project = await apiRequest<Project>(
      apiBaseUrl,
      `/projects/${encodeURIComponent(projectId)}`,
      bearerToken,
    );
    return normaliseProjectRestrictions(project);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}
