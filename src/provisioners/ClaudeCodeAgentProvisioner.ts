/**
 * Claude Code harness agent provisioner.
 *
 * Installs agents to ~/.claude/agents (system) or .claude/agents (repo).
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { AgentProvisioner } from './AgentProvisioner.js';

export class ClaudeCodeAgentProvisioner extends AgentProvisioner {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  getAgentsDir(): string {
    return path.join(homedir(), '.claude', 'agents');
  }

  getRepoAgentsDir(repoRoot: string): string {
    return path.join(repoRoot, '.claude', 'agents');
  }
}
