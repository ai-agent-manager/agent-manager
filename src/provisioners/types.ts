import type { SkillInfo, AgentInfo } from '../bundle/scanner.js';
import type { AgentDependencies } from '../bundle/manifest.js';
import type { InstallScope } from '../config/scopes.js';
import type { SkillSourcePin } from '../bundle/skill-source.js';

export type ProvisionerType = 'skill' | 'rovo-agent' | 'agent';

/** Common fields for all installed assets */
interface InstalledAssetBase {
  name: string;
  bundleVersion: string;
  installedAt: string;
  method: 'symlink' | 'copy';
  path: string;
}

/** An installed skill (SKILL.md-based) */
export interface InstalledSkill extends InstalledAssetBase {
  kind: 'skill';
}

/** An installed harness agent (AGENT.md-based) */
export interface InstalledAgent extends InstalledAssetBase {
  kind: 'agent';
  /** Tool IDs this agent supports (e.g., ['claude-code', 'cursor']) */
  tools: string[];
}

/** Union type for any installed asset */
export type InstalledItem = InstalledSkill | InstalledAgent;

export interface InstallResult {
  installed: Array<{ name: string; method: 'symlink' | 'copy'; path: string }>;
  errors: Array<{ name: string; error: string }>;
}

export interface UninstallResult {
  removed: Array<{ name: string }>;
  errors: Array<{ name: string; error: string }>;
}

/** Options for constructing a scoped provisioner */
export interface ProvisionerScope {
  scope: InstallScope;
  /** Required when scope is 'repo' — absolute path to the repository root */
  repoRoot?: string;
}

export interface Provisioner {
  readonly id: string;
  readonly name: string;
  readonly type: ProvisionerType;

  /** Check if this provisioner can operate */
  detect(): Promise<{ available: boolean; reason?: string }>;

  /** List currently installed items with their bundle versions */
  getInstalled(): Promise<InstalledSkill[]>;

  /** Install skills from the specified source */
  install(items: SkillInfo[], bundleVersion: string, sourcePin?: SkillSourcePin): Promise<InstallResult>;

  /** Uninstall previously installed skills */
  uninstall(names: string[]): Promise<UninstallResult>;
}

/**
 * Provisioner interface for harness agents (AGENT.md-based).
 * Agents install to tool-specific agents directories, not skills directories.
 */
export interface AgentProvisionerInterface {
  readonly id: string;
  readonly name: string;
  readonly type: 'agent';

  /** Get the system-wide agents directory for this tool */
  getAgentsDir(): string;

  /** Get the repo-scoped agents directory for this tool */
  getRepoAgentsDir(repoRoot: string): string;

  /** Check if this provisioner can operate */
  detect(): Promise<{ available: boolean; reason?: string }>;

  /** List currently installed agents with their bundle versions */
  getInstalled(): Promise<InstalledAgent[]>;

  /** Install agents from the specified source */
  installAgents(
    agents: AgentInfo[],
    bundleVersion: string,
    sourcePin?: SkillSourcePin,
  ): Promise<InstallResult>;

  /** Uninstall previously installed agents */
  uninstallAgents(names: string[]): Promise<UninstallResult>;

  /** Check which skills from dependencies are installed */
  checkDependencies(
    dependencies: AgentDependencies,
  ): Promise<{ installed: string[]; missing: string[] }>;
}

/** Progress callback for long-running operations (e.g., Rovo provisioning) */
export type ProgressCallback = (message: string, step?: number, totalSteps?: number) => void;
