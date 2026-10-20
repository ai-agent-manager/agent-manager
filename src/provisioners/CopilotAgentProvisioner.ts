/**
 * GitHub Copilot harness agent provisioner.
 *
 * Installs agents to ~/.copilot/agents (system) or .github/agents (repo).
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { AgentProvisioner } from './AgentProvisioner.js';

export class CopilotAgentProvisioner extends AgentProvisioner {
  readonly id = 'github-copilot';
  readonly name = 'GitHub Copilot';

  getAgentsDir(): string {
    return path.join(homedir(), '.copilot', 'agents');
  }

  getRepoAgentsDir(repoRoot: string): string {
    return path.join(repoRoot, '.github', 'agents');
  }
}
