import path from 'node:path';
import { SkillProvisioner } from './SkillProvisioner.js';
import { getHomeDir } from '../lib/platform.js';
import type { ProvisionerScope } from './types.js';

export class DevinDesktopProvisioner extends SkillProvisioner {
  // Windsurf was rebranded to Devin Desktop (Cognition); id/paths kept as 'windsurf'
  // since that's what's persisted in existing users' cache.json and repo configs,
  // and the on-disk directories are unchanged post-rebrand.
  readonly id = 'windsurf';
  readonly name = 'Devin Desktop';

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
