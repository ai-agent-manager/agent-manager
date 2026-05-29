import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getHomeDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class WindsurfProvisioner extends SkillProvisioner {
  readonly id = 'windsurf';
  readonly name = 'Windsurf';

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return path.join(getHomeDir(), '.codeium', 'windsurf', 'skills');
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, '.windsurf', 'skills');
  }
}
