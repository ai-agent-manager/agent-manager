import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv/dist/2020.js';
import { parseFrontmatter, type AssetConfig } from '../lib/frontmatter.js';
import type { AgentManifestEntry } from './manifest.js';
import type { SkillSourcePin } from './skill-source.js';

// ---------------------------------------------------------------------------
// Schema validation setup
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the JSON Schema from the schemas/ directory at the package root.
// In the compiled output (dist/bundle/scanner.js) the schema is at
// ../../schemas/rovo-agent.schema.json relative to the .js file.
// In the source (src/bundle/scanner.ts) it's also ../../schemas/.
const schemaPath = path.resolve(__dirname, '../../schemas/rovo-agent.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

const ajv = new Ajv2020({ allErrors: true });
const validateSchema = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Types — mirrors the rovo-agent.yaml structure
// ---------------------------------------------------------------------------

/**
 * A `$file` reference that points to an external text file whose contents
 * replace this value at parse time.  Paths are resolved relative to the
 * directory containing the `rovo-agent.yaml` file.
 */
export interface FileRef {
  $file: string;
}

/**
 * Fields that support external file references accept either an inline
 * string **or** a `{ $file: './relative/path.md' }` object.
 */
export type StringOrFileRef = string | FileRef;

/** Type guard — returns `true` when the value is a `{ $file }` reference. */
export function isFileRef(value: StringOrFileRef): value is FileRef {
  return typeof value === 'object' && value !== null && '$file' in value;
}

// -- Resolved types (after $file resolution — all fields are plain strings) --

/** Supported `apiVersion` values for rovo-agent.yaml manifests. v1 is archived. */
export type RovoApiVersion = 'rovo.atlassian.com/v2-beta';

export interface RovoAgentIdentity {
  /** Agent display name (max 30 chars in Studio) */
  name: string;
  /** Short description (max 400 chars in Studio) */
  description: string;
  /** Optional emoji avatar */
  avatar?: string;
  /** Optional conversation starter prompts */
  conversationStarters?: string[];
}

export interface RovoDefaultScenario {
  /** Multi-line instructions */
  instructions: string;
  /** Knowledge scope: all | custom | none (default: all) */
  knowledge?: 'all' | 'custom' | 'none';
  /** Enable web search */
  webSearch?: boolean;
  /** Skills available in this scenario (display names from Studio) */
  skills?: string[];
  /** Enable deep research */
  deepResearch?: boolean;
}

export interface RovoCustomScenario extends RovoDefaultScenario {
  /** Scenario display name */
  name: string;
  /** Natural language trigger description */
  trigger: string;
  /** Whether the scenario is enabled (default: true) */
  enabled?: boolean;
  /** Stable identifier — the subagents{} key from YAML. */
  key?: string;
  /** Conversation starters scoped to this subagent. */
  conversationStarters?: string[];
}

export interface RovoKnowledgeSource {
  /** Atlassian product integration type */
  type: 'confluence' | 'jira' | 'jsm' | 'atlassian-support-docs';
  /** Filter: 'all' for all content, or a specific space/project identifier */
  filter?: string;
}

/**
 * Canonical, fully-resolved Rovo agent configuration.
 *
 * v2-beta YAML is normalised into this shape during parsing so all
 * downstream consumers can read `config.identity.*` and `config.scenarios.*`
 * uniformly.
 *
 * Normalisation map:
 *  - `name` → `identity.name`
 *  - `description` → `identity.description`
 *  - `instructions` → `scenarios.default.instructions`
 *  - `conversationStarters` → `identity.conversationStarters`
 *  - `skills` / `knowledge` / `webSearch` / `deepResearch` → `scenarios.default.*`
 *  - `subagents{}` → `scenarios.custom[]` (with `key` set to the map key)
 */
export interface RovoAgentConfig {
  apiVersion: RovoApiVersion;
  kind: 'StudioAgent';
  identity: RovoAgentIdentity;
  scenarios: {
    default: RovoDefaultScenario;
    custom?: RovoCustomScenario[];
  };
  knowledgeSources?: RovoKnowledgeSource[];
}

// -- Raw types (before $file resolution — may contain FileRef objects) -------

export interface RovoAgentSubagentRaw {
  name: string;
  enabled: boolean;
  trigger?: string;
  instructions?: StringOrFileRef;
  conversationStarters?: string[];
  skills?: string[];
  knowledge?: 'all' | 'custom' | 'none';
  webSearch?: boolean;
  deepResearch?: boolean;
}

export interface RovoAgentConfigRaw {
  apiVersion: 'rovo.atlassian.com/v2-beta';
  kind: 'StudioAgent';
  name: string;
  description: string;
  instructions: StringOrFileRef;
  conversationStarters?: string[];
  skills?: string[];
  knowledge?: 'all' | 'custom' | 'none';
  webSearch?: boolean;
  deepResearch?: boolean;
  subagents?: Record<string, RovoAgentSubagentRaw>;
  knowledgeSources?: RovoKnowledgeSource[];
}

// ---------------------------------------------------------------------------
// Bundle scanning types (unchanged shape, updated config type)
// ---------------------------------------------------------------------------

export interface SkillInfo {
  /** Resolved source pin — set for artefact and repo skills; undefined for bundle skills. */
  sourcePin?: SkillSourcePin;
  /** Directory name (e.g., 'web-frontend-skill') */
  dirName: string;
  /** Absolute path to the skill directory */
  dirPath: string;
  /** Absolute path to SKILL.md */
  skillMdPath: string;
  /** Metadata from README.md frontmatter, if available */
  meta: AssetConfig | null;
}

/**
 * A Markdown file discovered under an agent's `assets/knowledge-base/` directory.
 * These files can be uploaded to Confluence as individual pages during provisioning.
 */
export interface KnowledgeBaseFile {
  /** Page title derived from the filename (without the `.md` extension) */
  title: string;
  /** Absolute path to the `.md` file */
  filePath: string;
}

export interface RovoAgentInfo {
  /** Directory name (e.g., 'epic-elaboration-agent') */
  dirName: string;
  /** Absolute path to the agent directory */
  dirPath: string;
  /** Absolute path to rovo-agent.yaml */
  configPath: string;
  /** Parsed and validated agent configuration */
  config: RovoAgentConfig;
  /** Metadata from README.md frontmatter, if available */
  meta: AssetConfig | null;
  /**
   * Markdown files found under `assets/knowledge-base/` within the agent directory.
   * Empty when the directory does not exist or contains no `.md` files.
   */
  knowledgeBaseFiles: KnowledgeBaseFile[];
}

export interface BundleContents {
  skills: SkillInfo[];
  rovoAgents: RovoAgentInfo[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class RovoAgentValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid rovo-agent.yaml:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'RovoAgentValidationError';
  }
}

/** Warnings emitted during the most recent parseRovoAgentYaml call. */
export let lastParseWarnings: string[] = [];

/**
 * Apply best-effort fixups to the parsed YAML data before strict schema
 * validation.  This lets us accept slightly non-conformant manifests (e.g.
 * bundles authored before a constraint was tightened) while still warning
 * the user.
 */
function normaliseBeforeValidation(data: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  // Truncate top-level conversationStarters to 3 (Studio limit).
  const topStarters = data?.conversationStarters;
  if (Array.isArray(topStarters) && topStarters.length > 3) {
    const dropped = topStarters.length - 3;
    data.conversationStarters = topStarters.slice(0, 3);
    warnings.push(
      `conversationStarters has ${dropped + 3} items but Studio allows max 3 — truncated to first 3`
    );
  }

  return warnings;
}

/**
 * Parse and validate a rovo-agent.yaml string.  Throws
 * {@link RovoAgentValidationError} if the content doesn't conform to the
 * schema or if any `$file` reference cannot be resolved.
 *
 * Only `apiVersion: rovo.atlassian.com/v2-beta` is supported (v1 is archived).
 * Best-effort fixups (e.g. truncating conversationStarters) are applied
 * before validation.  Warnings are stored in {@link lastParseWarnings}.
 *
 * @param yamlContent  Raw YAML string.
 * @param baseDir      Directory containing the rovo-agent.yaml file, used to
 *                     resolve `$file` references.  Defaults to `process.cwd()`.
 */
export async function parseRovoAgentYaml(
  yamlContent: string,
  baseDir: string = process.cwd(),
): Promise<RovoAgentConfig> {
  const data = parseYaml(yamlContent);

  // Apply fixups and collect warnings
  lastParseWarnings = normaliseBeforeValidation(data as Record<string, unknown>);

  if (!validateSchema(data)) {
    const errors = (validateSchema.errors ?? []).map((e: ErrorObject) => {
      const loc = e.instancePath || '/';
      return `${loc}: ${e.message ?? 'unknown error'}`;
    });
    throw new RovoAgentValidationError(errors);
  }

  return resolveFileRefs(data as RovoAgentConfigRaw, baseDir);
}

// ---------------------------------------------------------------------------
// $file resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single {@link StringOrFileRef} value.  If the value is an inline
 * string it is returned as-is.  If it is a `{ $file }` reference, the
 * referenced file is read and its contents returned.
 *
 * @param value    The value to resolve.
 * @param baseDir  Base directory for resolving relative paths.
 * @param field    Human-readable field path for error messages (e.g.
 *                 `"instructions"`).
 */
async function resolveValue(
  value: StringOrFileRef,
  baseDir: string,
  field: string,
): Promise<string> {
  if (!isFileRef(value)) return value;

  const relPath = value.$file;

  // Safety: reject absolute paths
  if (path.isAbsolute(relPath)) {
    throw new RovoAgentValidationError([
      `${field}: $file path must be relative, got absolute path '${relPath}'`,
    ]);
  }

  // Safety: reject '..' path segments (also caught by the schema regex, but
  // belt-and-suspenders)
  if (relPath.split(/[/\\]/).includes('..')) {
    throw new RovoAgentValidationError([
      `${field}: $file path must not contain '..' segments: '${relPath}'`,
    ]);
  }

  const resolved = path.resolve(baseDir, relPath);

  // Safety: ensure the resolved path is still within baseDir
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    throw new RovoAgentValidationError([
      `${field}: $file path '${relPath}' resolves outside the agent directory`,
    ]);
  }

  try {
    return await readFile(resolved, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new RovoAgentValidationError([
      `${field}: failed to read $file '${relPath}': ${msg}`,
    ]);
  }
}

/**
 * Walk a raw (schema-validated but unresolved) v2-beta config, resolve any
 * `$file` references, and normalise into the canonical {@link RovoAgentConfig}
 * shape so all downstream consumers can read `config.identity.*` and
 * `config.scenarios.*` uniformly.
 *
 * Mapping:
 *  - `name` → `identity.name`
 *  - `description` → `identity.description`
 *  - `instructions` → `scenarios.default.instructions`
 *  - `conversationStarters` → `identity.conversationStarters`
 *  - `skills` / `knowledge` / `webSearch` / `deepResearch` → `scenarios.default.*`
 *  - `subagents{}` → `scenarios.custom[]` (with `key` set to map key,
 *    `enabled` preserved, missing `trigger`/`instructions` defaulted to '')
 */
async function resolveFileRefs(
  raw: RovoAgentConfigRaw,
  baseDir: string,
): Promise<RovoAgentConfig> {
  const instructions = await resolveValue(
    raw.instructions,
    baseDir,
    'instructions',
  );

  // Convert subagents{} → custom[] preserving key for stable ordering / lookup
  const subagentEntries = raw.subagents ? Object.entries(raw.subagents) : [];
  const customScenarios: RovoCustomScenario[] | undefined =
    subagentEntries.length > 0
      ? await Promise.all(
          subagentEntries.map(async ([key, sub]) => {
            const subInstructions = sub.instructions
              ? await resolveValue(
                  sub.instructions,
                  baseDir,
                  `subagents.${key}.instructions`,
                )
              : '';
            const scenario: RovoCustomScenario = {
              key,
              name: sub.name,
              trigger: sub.trigger ?? '',
              instructions: subInstructions,
              enabled: sub.enabled,
            };
            if (sub.knowledge !== undefined) scenario.knowledge = sub.knowledge;
            if (sub.webSearch !== undefined) scenario.webSearch = sub.webSearch;
            if (sub.deepResearch !== undefined) scenario.deepResearch = sub.deepResearch;
            if (sub.skills !== undefined) scenario.skills = sub.skills;
            if (sub.conversationStarters !== undefined) {
              scenario.conversationStarters = sub.conversationStarters;
            }
            return scenario;
          }),
        )
      : undefined;

  const identity: RovoAgentIdentity = {
    name: raw.name,
    description: raw.description,
  };
  if (raw.conversationStarters) identity.conversationStarters = raw.conversationStarters;

  const defaultScenario: RovoDefaultScenario = { instructions };
  if (raw.knowledge !== undefined) defaultScenario.knowledge = raw.knowledge;
  if (raw.webSearch !== undefined) defaultScenario.webSearch = raw.webSearch;
  if (raw.deepResearch !== undefined) defaultScenario.deepResearch = raw.deepResearch;
  if (raw.skills !== undefined) defaultScenario.skills = raw.skills;

  const config: RovoAgentConfig = {
    apiVersion: raw.apiVersion,
    kind: raw.kind,
    identity,
    scenarios: {
      default: defaultScenario,
      ...(customScenarios !== undefined ? { custom: customScenarios } : {}),
    },
  };
  if (raw.knowledgeSources) config.knowledgeSources = raw.knowledgeSources;
  return config;
}

// ---------------------------------------------------------------------------
// Bundle scanner
// ---------------------------------------------------------------------------

/**
 * Scan a bundle directory to discover skills (SKILL.md) and rovo agents (rovo-agent.yaml).
 *
 * When `manifestAgents` is provided (from an enriched manifest), metadata is
 * read from the manifest entries instead of parsing each agent's README.md.
 * This avoids redundant frontmatter parsing at scan time since the bundler
 * already extracted the metadata at publish time.
 *
 * Falls back to README parsing when `manifestAgents` is not provided (e.g.
 * local imports via `imposter import`).
 */
export async function scanBundle(
  bundleDir: string,
  manifestAgents?: AgentManifestEntry[],
): Promise<BundleContents> {
  const skills: SkillInfo[] = [];
  const rovoAgents: RovoAgentInfo[] = [];

  // Build a lookup map from manifest agents for O(1) access by directory name
  const manifestMap = new Map<string, AgentManifestEntry>();
  if (manifestAgents) {
    for (const entry of manifestAgents) {
      manifestMap.set(entry.id, entry);
    }
  }

  const entries = await readdir(bundleDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const dirPath = path.join(bundleDir, entry.name);

    // Check for SKILL.md (agent skill)
    const skillMdPath = path.join(dirPath, 'SKILL.md');
    const hasSkillMd = await fileExists(skillMdPath);

    // Check for rovo-agent.yaml (Rovo agent)
    const rovoConfigPath = path.join(dirPath, 'rovo-agent.yaml');
    const hasRovoConfig = await fileExists(rovoConfigPath);

    // Resolve metadata: prefer manifest, fall back to README parsing
    const meta = manifestMap.has(entry.name)
      ? manifestEntryToAssetConfig(manifestMap.get(entry.name)!)
      : await readAssetMeta(dirPath);

    if (hasSkillMd) {
      skills.push({
        dirName: entry.name,
        dirPath,
        skillMdPath,
        meta,
      });
    }

    if (hasRovoConfig) {
      try {
        const raw = await readFile(rovoConfigPath, 'utf-8');
        const config = await parseRovoAgentYaml(raw, dirPath);

        // Surface any normalisation warnings
        if (lastParseWarnings.length > 0) {
          for (const w of lastParseWarnings) {
            process.stderr.write(`[warn] ${entry.name}/rovo-agent.yaml: ${w}\n`);
          }
        }

        const knowledgeBaseFiles = await scanKnowledgeBase(dirPath);

        rovoAgents.push({
          dirName: entry.name,
          dirPath,
          configPath: rovoConfigPath,
          config,
          meta,
          knowledgeBaseFiles,
        });
      } catch (err) {
        // Log the error so authors can diagnose why an agent was skipped
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[warn] Skipping ${entry.name}/rovo-agent.yaml: ${msg}\n`);
      }
    }
  }

  return { skills, rovoAgents };
}

/** Convert a manifest entry to the scanner's AssetConfig shape. */
function manifestEntryToAssetConfig(entry: AgentManifestEntry): AssetConfig | null {
  if (!entry.name || !entry.description) return null;
  const config: AssetConfig = {
    name: entry.name,
    description: entry.description,
  };
  if (entry.tags && entry.tags.length > 0) config.tags = entry.tags;
  return config;
}

async function scanKnowledgeBase(agentDir: string): Promise<KnowledgeBaseFile[]> {
  const kbDir = path.join(agentDir, 'assets', 'knowledge-base');
  try {
    const entries = await readdir(kbDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => ({
        title: e.name.replace(/\.md$/i, ''),
        filePath: path.join(kbDir, e.name),
      }));
  } catch {
    // Directory does not exist — agent simply has no knowledge base files
    return [];
  }
}

async function readAssetMeta(dirPath: string): Promise<AssetConfig | null> {
  const readmePath = path.join(dirPath, 'README.md');
  try {
    const content = await readFile(readmePath, 'utf-8');
    const result = parseFrontmatter(content);
    return result?.meta ?? null;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
