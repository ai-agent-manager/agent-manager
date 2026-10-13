/**
 * Base class for harness agent provisioners.
 *
 * Harness agents are installed to tool-specific agents directories (e.g.,
 * ~/.claude/agents, ~/.cursor/agents) and use composition at install time
 * to merge root AGENT.md with tool adapter frontmatter and body.
 */

import { readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { SkillSourcePin } from '../bundle/skill-source.js';
import type {
  InstalledSkill,
  InstallResult,
  UninstallResult,
  AgentProvisionerInterface,
} from './types.js';
import { composeAgent } from '../lib/agent-composer.js';
import { ensureDir, pathExists, writeFileAtomic } from '../lib/fs.js';
import { recordInstall, removeInstallRecord, readConfig } from '../bundle/cache.js';
import { recordRepoInstall, removeRepoInstallRecord, readRepoConfig } from '../bundle/repo-config.js';

type AgentInstallRecord = {
  bundleVersion?: string;
  installedAt: string;
  method: 'symlink' | 'copy'; // Match the stored record type
  sourcePin?: SkillSourcePin;
};

/**
 * Abstract base class for harness agent provisioners.
 *
 * Subclasses must implement:
 * - `id`: The tool identifier (e.g., 'claude-code', 'cursor')
 * - `name`: Human-readable tool name
 * - `getAgentsDir()`: System-wide agents directory path
 * - `getRepoAgentsDir(repoRoot)`: Repo-scoped agents directory path
 */
export abstract class AgentProvisioner implements AgentProvisionerInterface {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly type = 'agent' as const;

  protected readonly scope: InstallScope;
  protected readonly repoRoot: string | undefined;

  constructor(options?: { scope?: InstallScope; repoRoot?: string }) {
    this.scope = options?.scope ?? 'system';
    this.repoRoot = options?.repoRoot;

    if (this.scope === 'repo' && !this.repoRoot) {
      throw new Error('repoRoot is required when scope is "repo"');
    }
  }

  /** Subclasses return the tool's system-wide agents directory */
  abstract getAgentsDir(): string;

  /** Subclasses return the tool's repo-scoped agents directory */
  abstract getRepoAgentsDir(repoRoot: string): string;

  /** Resolve the effective agents directory based on scope */
  getEffectiveAgentsDir(): string {
    if (this.scope === 'repo' && this.repoRoot) {
      return this.getRepoAgentsDir(this.repoRoot);
    }
    return this.getAgentsDir();
  }

  async detect(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async getInstalled(): Promise<InstalledSkill[]> {
    const agentsDir = this.getEffectiveAgentsDir();
    if (!(await pathExists(agentsDir))) return [];

    // Agent installs are tracked with <tool-id>-agents key
    const stateKey = `${this.id}-agents`;
    let installRecords: Record<string, AgentInstallRecord> = {};

    if (this.scope === 'repo' && this.repoRoot) {
      const repoConfig = await readRepoConfig(this.repoRoot);
      installRecords = repoConfig?.installations[stateKey] ?? {};
    } else {
      const config = await readConfig();
      installRecords = config.installations[stateKey] ?? {};
    }

    const installed: InstalledSkill[] = [];
    const coveredAgents = new Set<string>();

    // Check tracked installs
    for (const [agentName, record] of Object.entries(installRecords)) {
      const agentPath = path.join(agentsDir, agentName);
      if (!(await pathExists(agentPath))) continue;

      coveredAgents.add(agentName);
      installed.push({
        name: agentName,
        bundleVersion: record.bundleVersion ?? 'unknown',
        installedAt: record.installedAt ?? 'unknown',
        method: 'copy',
        path: agentPath,
      });
    }

    // Check for orphaned installs (files not tracked in state)
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (coveredAgents.has(entry.name)) continue;

      const agentPath = path.join(agentsDir, entry.name);
      installed.push({
        name: entry.name,
        bundleVersion: 'unknown',
        installedAt: 'unknown',
        method: 'copy',
        path: agentPath,
      });
    }

    return installed;
  }

  async installAgents(
    agents: AgentInfo[],
    bundleVersion: string,
    sourcePin?: SkillSourcePin,
  ): Promise<InstallResult> {
    const agentsDir = this.getEffectiveAgentsDir();
    await ensureDir(agentsDir);

    const result: InstallResult = { installed: [], errors: [] };

    for (const agent of agents) {
      try {
        // Compose the agent for this tool
        const composed = await composeAgent(agent.dirPath, this.id);

        // Create the agent directory
        const targetDir = path.join(agentsDir, agent.dirName);
        await ensureDir(targetDir);

        // Write the composed AGENT.md
        const targetAgentMd = path.join(targetDir, 'AGENT.md');
        await writeFileAtomic(targetAgentMd, composed.content);

        // Copy sibling files from tool adapter directory
        for (const siblingFile of composed.siblingFiles) {
          const fileName = path.basename(siblingFile);
          const targetPath = path.join(targetDir, fileName);
          await copyFile(siblingFile, targetPath);
        }

        // Record the installation
        const record: AgentInstallRecord = {
          bundleVersion: bundleVersion || undefined,
          installedAt: new Date().toISOString(),
          method: 'copy',
          sourcePin,
        };

        const stateKey = `${this.id}-agents`;
        if (this.scope === 'repo' && this.repoRoot) {
          await recordRepoInstall(this.repoRoot, stateKey, agent.dirName, record, bundleVersion || undefined);
        } else {
          await recordInstall(stateKey, agent.dirName, record);
        }

        result.installed.push({
          name: agent.dirName,
          method: 'copy',
          path: targetDir,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({
          name: agent.dirName,
          error: message,
        });
      }
    }

    return result;
  }

  async uninstallAgents(names: string[]): Promise<UninstallResult> {
    const agentsDir = this.getEffectiveAgentsDir();
    const result: UninstallResult = { removed: [], errors: [] };

    const stateKey = `${this.id}-agents`;

    for (const name of names) {
      const agentPath = path.join(agentsDir, name);

      try {
        // Remove the agent directory
        if (await pathExists(agentPath)) {
          await rm(agentPath, { recursive: true, force: true });
        }

        // Remove from state
        if (this.scope === 'repo' && this.repoRoot) {
          await removeRepoInstallRecord(this.repoRoot, stateKey, name);
        } else {
          await removeInstallRecord(stateKey, name);
        }

        result.removed.push({ name });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ name, error: message });
      }
    }

    return result;
  }
}
