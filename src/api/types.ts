/**
 * Project types aligned with the authenticated backend API
 * (`GET /projects`, `GET /projects/{projectId}`).
 */

/** Optional restriction fields — missing on legacy API responses. */
export interface ProjectRestrictions {
  /**
   * When false/absent (default), all catalogue agents are enabled.
   * When true, only `allowedAgentIds` are enabled.
   */
  restrictAgents?: boolean;
  /**
   * When false/absent (default), all catalogue skills are enabled.
   * When true, only `allowedSkillIds` are enabled.
   */
  restrictSkills?: boolean;
  /** Agent IDs (directory names) allowed when `restrictAgents` is true. */
  allowedAgentIds?: string[];
  /** Skill IDs (directory names) allowed when `restrictSkills` is true. */
  allowedSkillIds?: string[];
}

export interface Project extends ProjectRestrictions {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  /** Tool identifiers configured for this project. */
  toolIds: string[];
  /** Explicit project admin emails (optional; older APIs may omit this field). */
  adminEmails?: string[];
  createdAt: string;
  updatedAt: string;
}
