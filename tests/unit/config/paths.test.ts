import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { getHomeDir } from '../../../src/lib/platform.js';
import {
  getAgentmanDir,
  getBundlesDir,
  getBundleVersionDir,
  getCurrentBundleLink,
  getConfigPath,
  getConfigLockPath,
  getTempDir,
  getAuthDir,
  getAtlassianAuthPath,
  AUTH_TTL_MS,
} from '../../../src/config/paths.js';

const home = getHomeDir();

describe('getAgentmanDir', () => {
  it('returns a path under the home directory', () => {
    const dir = getAgentmanDir();
    expect(dir).toBe(path.join(home, '.agentman'));
  });
});

describe('getBundlesDir', () => {
  it('returns a path under agentman dir', () => {
    const dir = getBundlesDir();
    expect(dir).toBe(path.join(home, '.agentman', 'bundles'));
  });
});

describe('getBundleVersionDir', () => {
  it('appends the version to the bundles directory', () => {
    const dir = getBundleVersionDir('abc123');
    expect(dir).toBe(path.join(home, '.agentman', 'bundles', 'abc123'));
  });

  it('handles long git hashes', () => {
    const hash = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const dir = getBundleVersionDir(hash);
    expect(dir.endsWith(hash)).toBe(true);
  });
});

describe('getCurrentBundleLink', () => {
  it('returns a "current" path under agentman dir', () => {
    const link = getCurrentBundleLink();
    expect(link).toBe(path.join(home, '.agentman', 'current'));
  });
});

describe('getConfigPath', () => {
  it('returns a config.json path under agentman dir', () => {
    const configPath = getConfigPath();
    expect(configPath).toBe(path.join(home, '.agentman', 'config.json'));
  });
});

describe('getConfigLockPath', () => {
  it('returns a config.json.lock path under agentman dir', () => {
    const lockPath = getConfigLockPath();
    expect(lockPath).toBe(path.join(home, '.agentman', 'config.json.lock'));
  });
});

describe('getTempDir', () => {
  it('returns a tmp path under agentman dir', () => {
    const tmp = getTempDir();
    expect(tmp).toBe(path.join(home, '.agentman', 'tmp'));
  });
});

describe('getAuthDir', () => {
  it('returns an auth path under agentman dir', () => {
    const authDir = getAuthDir();
    expect(authDir).toBe(path.join(home, '.agentman', 'auth'));
  });
});

describe('getAtlassianAuthPath', () => {
  it('returns atlassian-studio.json under auth dir', () => {
    const authPath = getAtlassianAuthPath();
    expect(authPath).toBe(path.join(home, '.agentman', 'auth', 'atlassian-studio.json'));
  });
});

describe('AUTH_TTL_MS', () => {
  it('is 24 hours in milliseconds', () => {
    expect(AUTH_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
