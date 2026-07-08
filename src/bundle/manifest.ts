/**
 * Bundle manifest types for agentman.
 *
 * These types represent the manifest.json format produced by agent-bundler and
 * read by agentman during bundle download, extraction, and import flows.
 *
 * They are intentionally kept as a local copy so existing bundle flows
 * continue to work without modification (backward compatibility).
 *
 * A future task will import from a shared published package once one is
 * available, consolidating these definitions with the canonical schema.
 *
 * Divergences from the agent-bundler producer type:
 *   - phases?: string[]  — present in bundler output; optional here so
 *     legacy manifests without phases parse cleanly.
 *   - agents?: AgentManifestEntry[] — kept optional for backward compatibility with
 *     manifests produced before agents was required.
 */

/** Video metadata from manifest entry. */
export interface ManifestVideoEntry {
  title: string;
  src: string;
}

/** Metadata for a single agent, as stored in the manifest by agent-bundler. */
export interface AgentManifestEntry {
  /** Directory name (used as the agent ID). */
  id: string;
  /** Display name from README frontmatter. */
  name: string;
  /** Description from README frontmatter. */
  description: string;
  /** Tags from README frontmatter. */
  tags?: string[];
  /**
   * SDLC phases this agent/skill participates in (e.g. "design", "build").
   * Optional so that legacy manifests without the field parse cleanly.
   *
   * Typed as string[] rather than a stricter enum to avoid coupling to
   * the shared manifest schema before it is available as a package.
   */
  phases?: string[];
  /** Video entries from README frontmatter. */
  videos?: ManifestVideoEntry[];
}

/** Written by agent-bundler as manifest.json at the root of every agents zip. */
export interface BundleManifest {
  /** ISO 8601 timestamp when the bundle was created. */
  published: string;
  /** Git commit SHA of the source at bundle time. */
  version: string;
  /** Agent metadata extracted from README frontmatter, sorted by ID. */
  agents?: AgentManifestEntry[];
}

export function parseManifest(raw: string): BundleManifest {
  const parsed = JSON.parse(raw);
  if (!parsed.version || typeof parsed.version !== 'string') {
    throw new Error('Invalid manifest: missing or invalid "version" field');
  }
  if (!parsed.published || typeof parsed.published !== 'string') {
    throw new Error('Invalid manifest: missing or invalid "published" field');
  }
  const manifest: BundleManifest = {
    version: parsed.version,
    published: parsed.published,
  };
  if (Array.isArray(parsed.agents)) {
    manifest.agents = parsed.agents;
  }
  return manifest;
}
