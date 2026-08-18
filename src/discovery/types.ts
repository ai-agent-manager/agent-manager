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

interface DiscoverySourceBase {
  /**
   * Stable logical source name. This is the source's identity everywhere it is
   * referred to — install namespaces, pins, coordinates — and is deliberately
   * independent of where the content is hosted, so a source can move without
   * breaking anything already installed. Unique within a discovery document.
   */
  name: string;
  /** Trust level indicator. */
  status?: SourceStatus;
}

/**
 * HTTP bundle source. `url` is the content root: the directory owning this
 * source's `index.json` and its versioned subdirectories. The client appends
 * nothing of its own to it.
 */
export interface HttpDiscoverySource extends DiscoverySourceBase {
  type: 'http';
  url: string;
}

export interface GitDiscoverySource extends DiscoverySourceBase {
  type: 'git';
  /** Git repository URL. */
  url: string;
}

export interface ArtefactDiscoverySource extends DiscoverySourceBase {
  type: 'artefact';
  /** Direct URL to the packaged skill zip. */
  url: string;
}

export type DiscoverySource =
  | HttpDiscoverySource
  | GitDiscoverySource
  | ArtefactDiscoverySource;

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
