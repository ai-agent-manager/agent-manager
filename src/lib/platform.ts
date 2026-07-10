import os from 'node:os';
import path from 'node:path';

export type Platform = 'macos' | 'linux' | 'windows';

export function getPlatform(): Platform {
  switch (os.platform()) {
    case 'darwin': return 'macos';
    case 'win32': return 'windows';
    default: return 'linux';
  }
}

export function getHomeDir(): string {
  return os.homedir();
}

export function getCursorSkillsDir(): string {
  return path.join(getHomeDir(), '.cursor', 'skills');
}
