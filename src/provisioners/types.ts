import type { SkillInfo, RovoAgentInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';

export type ProvisionerType = 'skill' | 'rovo-agent';

export interface InstalledSkill {
  name: string;
  bundleVersion: string;
  installedAt: string;
  method: 'symlink' | 'copy';
  path: string;
}

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

  /** Install skills from the specified bundle */
  install(items: SkillInfo[], bundleVersion: string): Promise<InstallResult>;

  /** Uninstall previously installed skills */
  uninstall(names: string[]): Promise<UninstallResult>;
}

/** Progress callback for long-running operations (e.g., Rovo provisioning) */
export type ProgressCallback = (message: string, step?: number, totalSteps?: number) => void;
