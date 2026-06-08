/**
 * TypeScript types for the Agent Manager Discovery Document.
 * Corresponds to the JSON Schema at ./schema.json
 */

export interface DiscoveryAuth {
  /** Whether authentication is needed to access skills from this endpoint. */
  required: boolean;
  /**
   * URL to the standard OIDC discovery document.
   * Required when `required` is true.
   */
  oidcDiscoveryUrl?: string;
  /**
   * OAuth2 client ID that agent-manager should use.
   * Required when `required` is true.
   */
  clientId?: string;
  /** OAuth2 scopes to request. Defaults to ["openid"] if omitted. */
  scopes?: string[];
}

export type SkillType = 'http' | 'git';
export type SkillStatus = 'official' | 'community';

export interface DiscoverySkill {
  /** Skill identifier. */
  name: string;
  /** How to fetch the skill. */
  type: SkillType;
  /** Location of the skill (bundle URL for http, repository URL for git). */
  url: string;
  /** Trust level indicator. */
  status?: SkillStatus;
}

export interface DiscoveryTelemetry {
  /** Base URL of the telemetry endpoint. */
  url: string;
  /** Site identifier for the telemetry service. */
  siteId: string;
}

export interface DiscoveryDocument {
  /** Schema version. Must be "1". */
  version: '1';
  /** Authentication configuration. Omit if no auth required. */
  auth?: DiscoveryAuth;
  /** Telemetry configuration. Omit to leave telemetry unconfigured. */
  telemetry?: DiscoveryTelemetry;
  /** List of available skills. */
  skills: DiscoverySkill[];
}
