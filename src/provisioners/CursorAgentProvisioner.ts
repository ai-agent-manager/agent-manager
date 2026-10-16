/**
 * Cursor harness agent provisioner.
 *
 * Installs agents to ~/.cursor/agents (system) or .cursor/agents (repo).
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { AgentProvisioner } from './AgentProvisioner.js';

export class CursorAgentProvisioner extends AgentProvisioner {
  readonly id = 'cursor';
  readonly name = 'Cursor';

  getAgentsDir(): string {
    return path.join(homedir(), '.cursor', 'agents');
  }

  getRepoAgentsDir(repoRoot: string): string {
    return path.join(repoRoot, '.cursor', 'agents');
  }
}
