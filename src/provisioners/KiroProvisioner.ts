import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getHomeDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class KiroProvisioner extends SkillProvisioner {
  readonly id = 'kiro';
  readonly name = 'Kiro';

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return path.join(getHomeDir(), '.kiro', 'skills');
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, '.kiro', 'skills');
  }
}