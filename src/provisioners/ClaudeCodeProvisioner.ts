import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getHomeDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class ClaudeCodeProvisioner extends SkillProvisioner {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return path.join(getHomeDir(), '.claude', 'skills');
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, '.claude', 'skills');
  }
}
