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
  switch (getPlatform()) {
    case 'macos':
      return path.join(getHomeDir(), 'Library', 'Application Support', 'Cursor', 'User', 'skills');
    case 'windows':
      return path.join(process.env['APPDATA'] ?? path.join(getHomeDir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'skills');
    default: {
      const xdgConfig = process.env['XDG_CONFIG_HOME'] ?? path.join(getHomeDir(), '.config');
      return path.join(xdgConfig, 'cursor', 'User', 'skills');
    }
  }
}
