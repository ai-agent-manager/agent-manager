import { describe, it, expect } from 'vitest';
import { getPlatform, getHomeDir } from '../../../src/lib/platform.js';

describe('getPlatform', () => {
  it('returns a valid platform', () => {
    const platform = getPlatform();
    expect(['macos', 'linux', 'windows']).toContain(platform);
  });
});

describe('getHomeDir', () => {
  it('returns a non-empty string', () => {
    const home = getHomeDir();
    expect(home).toBeTruthy();
    expect(typeof home).toBe('string');
  });
});
