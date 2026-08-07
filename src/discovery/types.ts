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

export type SourceType = 'http' | 'git' | 'artefact';
export type SourceStatus = 'official' | 'community';

export interface DiscoverySource {
  /** Source identifier. */
  name: string;
  /** How to fetch the source. */
  type: SourceType;
  /** Location of the source (bundle URL for http, repository URL for git). */
  url: string;
  /**
   * `http` sources only. Path prefix inserted between the `agents/` segment
   * and `index.json`/`<version>/bundle.zip`, letting several independent
   * bundle streams live under one origin (e.g. one bucket hosting multiple
   * teams' skills). Omit for the single-stream layout used today.
   */
  basePath?: string;
  /** Trust level indicator. */
  status?: SourceStatus;
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
  /** List of available sources. */
  sources: DiscoverySource[];
}
