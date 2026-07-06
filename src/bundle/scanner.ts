import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv/dist/2020.js';
import { parseFrontmatter, type AssetConfig } from '../lib/frontmatter.js';
import type { AgentManifestEntry } from './manifest.js';

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

export interface RovoAgentIdentity {
  /** Agent display name (max 30 chars in Studio) */
  name: string;
  /** Short description (max 400 chars in Studio) */
  description: string;
  /** Optional emoji avatar */
  avatar?: string;
  /** Multi-line behaviour text (tone, style, approach) */
  behavior: string;
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
}

export interface RovoCustomScenario extends RovoDefaultScenario {
  /** Scenario display name */
  name: string;
  /** Natural language trigger description */
  trigger: string;
  /** Enable deep research (only available on custom scenarios) */
  deepResearch?: boolean;
  /** Whether the scenario is enabled (default: true) */
  enabled?: boolean;
}

export interface RovoKnowledgeSource {
  /** Atlassian product integration type */
  type: 'confluence' | 'jira' | 'jsm' | 'atlassian-support-docs';
  /** Filter: 'all' for all content, or a specific space/project identifier */
  filter?: string;
}

export interface RovoAgentConfig {
  apiVersion: 'rovo.atlassian.com/v1';
  kind: 'StudioAgent';
  identity: RovoAgentIdentity;
  scenarios: {
    default: RovoDefaultScenario;
    custom?: RovoCustomScenario[];
  };
  knowledgeSources?: RovoKnowledgeSource[];
}

// -- Raw types (before $file resolution — may contain FileRef objects) -------

export interface RovoAgentIdentityRaw extends Omit<RovoAgentIdentity, 'behavior'> {
  behavior: StringOrFileRef;
}

export interface RovoDefaultScenarioRaw extends Omit<RovoDefaultScenario, 'instructions'> {
  instructions: StringOrFileRef;
}

export interface RovoCustomScenarioRaw extends Omit<RovoCustomScenario, 'instructions'> {
  instructions: StringOrFileRef;
}

export interface RovoAgentConfigRaw {
  apiVersion: 'rovo.atlassian.com/v1';
  kind: 'StudioAgent';
  identity: RovoAgentIdentityRaw;
  scenarios: {
    default: RovoDefaultScenarioRaw;
    custom?: RovoCustomScenarioRaw[];
  };
  knowledgeSources?: RovoKnowledgeSource[];
}

// ---------------------------------------------------------------------------
// Bundle scanning types (unchanged shape, updated config type)
// ---------------------------------------------------------------------------

export interface SkillInfo {
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
  const identity = data?.identity as Record<string, unknown> | undefined;

  if (Array.isArray(identity?.conversationStarters) && identity.conversationStarters.length > 3) {
    const dropped = identity.conversationStarters.length - 3;
    identity.conversationStarters = identity.conversationStarters.slice(0, 3);
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

  // Resolve any $file references to produce a fully-resolved config
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
 *                 `"scenarios.default.instructions"`).
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
 * Walk a raw (schema-validated but unresolved) config, read any `$file`
 * references, and return a fully-resolved {@link RovoAgentConfig} where
 * every field is a plain string.
 */
async function resolveFileRefs(
  raw: RovoAgentConfigRaw,
  baseDir: string,
): Promise<RovoAgentConfig> {
  // Resolve identity.behavior
  const behavior = await resolveValue(
    raw.identity.behavior,
    baseDir,
    'identity.behavior',
  );

  // Resolve scenarios.default.instructions
  const defaultInstructions = await resolveValue(
    raw.scenarios.default.instructions,
    baseDir,
    'scenarios.default.instructions',
  );

  // Resolve custom scenario instructions
  const customScenarios: RovoCustomScenario[] | undefined =
    raw.scenarios.custom
      ? await Promise.all(
          raw.scenarios.custom.map(async (s, i) => {
            const instructions = await resolveValue(
              s.instructions,
              baseDir,
              `scenarios.custom[${i}].instructions`,
            );
            return { ...s, instructions };
          }),
        )
      : undefined;

  return {
    ...raw,
    identity: { ...raw.identity, behavior },
    scenarios: {
      default: { ...raw.scenarios.default, instructions: defaultInstructions },
      ...(customScenarios !== undefined ? { custom: customScenarios } : {}),
    },
  };
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

export async function scanKnowledgeBase(agentDir: string): Promise<KnowledgeBaseFile[]> {
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
