import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getCursorSkillsDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class CursorProvisioner extends SkillProvisioner {
  readonly id = 'cursor';
  readonly name = 'Cursor';

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return getCursorSkillsDir();
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, '.cursor', 'skills');
  }
}
