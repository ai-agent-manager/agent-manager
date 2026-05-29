import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getHomeDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class CursorProvisioner extends SkillProvisioner {
  readonly id = 'cursor';
  readonly name = 'Cursor';

  constructor(options?: ProvisionerScope) {
    super(options);
  }

  getSkillsDir(): string {
    return path.join(getHomeDir(), '.agents', 'skills');
  }

  getRepoSkillsDir(repoRoot: string): string {
    return path.join(repoRoot, '.cursor', 'skills');
  }

  getNote(): string {
    return 'Cursor has no global skills path. Skills are installed to ~/.agents/skills/ (cross-client convention). You may need to configure Cursor to discover this path.';
  }
}
