import type { InstallScope } from "../config/scopes.js";
import { AgentsProvisioner } from "./AgentsProvisioner.js";
import { ClaudeCodeProvisioner } from "./ClaudeCodeProvisioner.js";
import { CopilotProvisioner } from "./CopilotProvisioner.js";
import { CursorProvisioner } from "./CursorProvisioner.js";
import { KiroProvisioner } from "./KiroProvisioner.js";
import { DevinDesktopProvisioner } from "./DevinDesktopProvisioner.js";
import type { SkillProvisioner } from "./SkillProvisioner.js";
import type { ProvisionerScope } from "./types.js";

export type SkillProvisionerClass = new (options?: ProvisionerScope) => SkillProvisioner;

export interface ToolDefinition {
  id: string;
  name: string;
  getSkillsDir: () => string;
  getRepoSkillsDir: (repoRoot: string) => string;
  note?: string;
  repoNote?: string;
}

/**
 * Single registry for skill-install tools.
 *
 * To add a new tool: create a SkillProvisioner subclass, then append it here.
 * UI (ToolSelector), headless install, and tool metadata all derive from this
 * list — no duplicate switch statements elsewhere.
 */
export const SKILL_PROVISIONER_CLASSES: readonly SkillProvisionerClass[] = [
  AgentsProvisioner,
  ClaudeCodeProvisioner,
  CursorProvisioner,
  CopilotProvisioner,
  KiroProvisioner,
  DevinDesktopProvisioner,
];

function toToolDefinition(ProvisionerClass: SkillProvisionerClass): ToolDefinition {
  const probe = new ProvisionerClass();
  const note = probe.getNote();

  return {
    id: probe.id,
    name: probe.name,
    getSkillsDir: () => probe.getSkillsDir(),
    getRepoSkillsDir: (repoRoot: string) => probe.getRepoSkillsDir(repoRoot),
    ...(note ? { note } : {}),
  };
}

let skillToolsCache: ToolDefinition[] | undefined;

export function getSkillTools(): ToolDefinition[] {
  if (!skillToolsCache) {
    skillToolsCache = SKILL_PROVISIONER_CLASSES.map(toToolDefinition).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  return skillToolsCache;
}

export function getToolById(id: string): ToolDefinition | undefined {
  return getSkillTools().find((tool) => tool.id === id);
}

function buildProvisionerMap(): Map<string, SkillProvisionerClass> {
  const map = new Map<string, SkillProvisionerClass>();

  for (const ProvisionerClass of SKILL_PROVISIONER_CLASSES) {
    const id = new ProvisionerClass().id;
    if (map.has(id)) {
      throw new Error(`Duplicate skill tool id in registry: ${id}`);
    }
    map.set(id, ProvisionerClass);
  }

  return map;
}

let provisionerById: Map<string, SkillProvisionerClass> | undefined;

function getProvisionerMap(): Map<string, SkillProvisionerClass> {
  if (!provisionerById) {
    provisionerById = buildProvisionerMap();
  }
  return provisionerById;
}

export function getSkillToolIds(): readonly string[] {
  return [...getProvisionerMap().keys()].sort();
}

export function formatSupportedSkillToolIds(): string {
  return getSkillToolIds()
    .map((id) => `'${id}'`)
    .join(", ");
}

export function createSkillProvisioner(
  toolId: string,
  scope: InstallScope,
  repoRoot?: string | null,
): SkillProvisioner {
  const ProvisionerClass = getProvisionerMap().get(toolId);
  if (!ProvisionerClass) {
    throw new Error(`Unknown tool: ${toolId}. Supported tools: ${formatSupportedSkillToolIds()}`);
  }

  const options: ProvisionerScope | undefined =
    scope === "repo" && repoRoot ? { scope: "repo", repoRoot } : undefined;

  return new ProvisionerClass(options);
}
