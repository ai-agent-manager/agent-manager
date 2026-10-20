/**
 * Registry for harness agent provisioners.
 *
 * Agent provisioners are separate from skill provisioners because they:
 * - Install to different directories (agents/ vs skills/)
 * - Use composition at install time
 * - Track state with different keys (<tool-id>-agents)
 */

import type { InstallScope } from '../config/scopes.js';
import type { AgentProvisionerInterface } from './types.js';
import { ClaudeCodeAgentProvisioner } from './ClaudeCodeAgentProvisioner.js';
import { CursorAgentProvisioner } from './CursorAgentProvisioner.js';
import { CopilotAgentProvisioner } from './CopilotAgentProvisioner.js';

export type AgentProvisionerClass = new (options?: {
  scope?: InstallScope;
  repoRoot?: string;
}) => AgentProvisionerInterface;

/**
 * All available agent provisioner classes.
 *
 * To add a new tool: create an AgentProvisioner subclass, then append it here.
 */
export const AGENT_PROVISIONER_CLASSES: readonly AgentProvisionerClass[] = [
  ClaudeCodeAgentProvisioner,
  CursorAgentProvisioner,
  CopilotAgentProvisioner,
];

function buildAgentProvisionerMap(): Map<string, AgentProvisionerClass> {
  const map = new Map<string, AgentProvisionerClass>();

  for (const ProvisionerClass of AGENT_PROVISIONER_CLASSES) {
    const probe = new ProvisionerClass();
    const id = probe.id;
    if (map.has(id)) {
      throw new Error(`Duplicate agent provisioner id in registry: ${id}`);
    }
    map.set(id, ProvisionerClass);
  }

  return map;
}

let provisionerById: Map<string, AgentProvisionerClass> | undefined;

function getAgentProvisionerMap(): Map<string, AgentProvisionerClass> {
  if (!provisionerById) {
    provisionerById = buildAgentProvisionerMap();
  }
  return provisionerById;
}

/**
 * Get all available agent provisioner tool IDs.
 */
export function getAgentToolIds(): readonly string[] {
  return [...getAgentProvisionerMap().keys()].sort();
}

/**
 * Format the list of supported agent tools for error messages.
 */
export function formatSupportedAgentToolIds(): string {
  return getAgentToolIds()
    .map((id) => `'${id}'`)
    .join(', ');
}

/**
 * Create an agent provisioner instance for the specified tool.
 */
export function createAgentProvisioner(
  toolId: string,
  scope: InstallScope,
  repoRoot?: string | null,
): AgentProvisionerInterface {
  const ProvisionerClass = getAgentProvisionerMap().get(toolId);
  if (!ProvisionerClass) {
    throw new Error(
      `Unknown agent tool: ${toolId}. Supported tools: ${formatSupportedAgentToolIds()}`
    );
  }

  const options: { scope: InstallScope; repoRoot?: string } | undefined =
    scope === 'repo' && repoRoot ? { scope: 'repo' as InstallScope, repoRoot } : undefined;

  return new ProvisionerClass(options);
}

/**
 * Check if a tool ID is a valid agent tool.
 */
export function isAgentTool(toolId: string): boolean {
  return getAgentProvisionerMap().has(toolId);
}

/**
 * Agent tool definition for UI display.
 */
export interface AgentToolDefinition {
  id: string;
  name: string;
  getAgentsDir: () => string;
  getRepoAgentsDir: (repoRoot: string) => string;
}

function toAgentToolDefinition(ProvisionerClass: AgentProvisionerClass): AgentToolDefinition {
  const probe = new ProvisionerClass();
  return {
    id: probe.id,
    name: probe.name,
    getAgentsDir: () => probe.getAgentsDir(),
    getRepoAgentsDir: (repoRoot: string) => probe.getRepoAgentsDir(repoRoot),
  };
}

let agentToolsCache: AgentToolDefinition[] | undefined;

/**
 * Get all available agent tools for UI display.
 */
export function getAgentTools(): AgentToolDefinition[] {
  if (!agentToolsCache) {
    agentToolsCache = AGENT_PROVISIONER_CLASSES.map(toAgentToolDefinition).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }
  return agentToolsCache;
}

/**
 * Get an agent tool definition by ID.
 */
export function getAgentToolById(id: string): AgentToolDefinition | undefined {
  return getAgentTools().find((tool) => tool.id === id);
}
