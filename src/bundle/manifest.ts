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
