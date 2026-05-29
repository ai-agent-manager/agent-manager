import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, stat, utimes, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { RovoProvisioner } from '../../../src/provisioners/RovoProvisioner.js';
import { AUTH_TTL_MS } from '../../../src/config/paths.js';

/**
 * Tests for RovoProvisioner auth state management (hasValidAuth, clearAuth).
 *
 * These tests use a temp directory to simulate ~/.agentman/auth/ and mock
 * the config/paths module to point there instead of the real home dir.
 */

// Create a unique temp dir per test run
const testAuthDir = path.join(tmpdir(), `agentman-test-auth-${Date.now()}`);
const testAuthPath = path.join(testAuthDir, 'atlassian-studio.json');

// Mock the paths module so the provisioner reads/writes to our temp dir
vi.mock('../../../src/config/paths.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/paths.js')>();
  return {
    ...original,
    getAuthDir: () => testAuthDir,
    getAtlassianAuthPath: () => testAuthPath,
  };
});

describe('RovoProvisioner - auth state management', () => {
  let provisioner: RovoProvisioner;

  beforeEach(async () => {
    provisioner = new RovoProvisioner();
    await mkdir(testAuthDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testAuthDir, { recursive: true, force: true });
  });

  describe('hasValidAuth', () => {
    it('returns false when no auth file exists', async () => {
      const result = await provisioner.hasValidAuth();
      expect(result).toBe(false);
    });

    it('returns true when auth file exists and is fresh', async () => {
      // Write a dummy auth state file
      await writeFile(testAuthPath, JSON.stringify({ cookies: [], origins: [] }));

      const result = await provisioner.hasValidAuth();
      expect(result).toBe(true);
    });

    it('returns false when auth file is older than TTL', async () => {
      // Write a dummy auth state file
      await writeFile(testAuthPath, JSON.stringify({ cookies: [], origins: [] }));

      // Set mtime to 25 hours ago (beyond the 24-hour TTL)
      const expiredTime = new Date(Date.now() - AUTH_TTL_MS - 60 * 60 * 1000);
      await utimes(testAuthPath, expiredTime, expiredTime);

      const result = await provisioner.hasValidAuth();
      expect(result).toBe(false);
    });

    it('returns true when auth file is just under the TTL', async () => {
      await writeFile(testAuthPath, JSON.stringify({ cookies: [], origins: [] }));

      // Set mtime to 23 hours ago (just under the 24-hour TTL)
      const freshTime = new Date(Date.now() - AUTH_TTL_MS + 60 * 60 * 1000);
      await utimes(testAuthPath, freshTime, freshTime);

      const result = await provisioner.hasValidAuth();
      expect(result).toBe(true);
    });
  });

  describe('clearAuth', () => {
    it('deletes the auth file when it exists', async () => {
      await writeFile(testAuthPath, JSON.stringify({ cookies: [], origins: [] }));

      // Verify file exists
      const before = await stat(testAuthPath).then(() => true).catch(() => false);
      expect(before).toBe(true);

      await provisioner.clearAuth();

      // Verify file is gone
      const after = await stat(testAuthPath).then(() => true).catch(() => false);
      expect(after).toBe(false);
    });

    it('does not throw when no auth file exists', async () => {
      // Should complete without error
      await expect(provisioner.clearAuth()).resolves.toBeUndefined();
    });
  });

  describe('createAgent', () => {
    it('throws when no valid auth state exists', async () => {
      await expect(
        provisioner.createAgent({
          studioUrl: 'https://studio.atlassian.com/s/test/agents',
          config: {
            apiVersion: 'rovo.atlassian.com/v1',
            kind: 'StudioAgent',
            identity: {
              name: 'Test Agent',
              description: 'A test agent',
              behavior: 'Be helpful',
            },
            scenarios: {
              default: {
                instructions: 'Help the user',
              },
            },
          },
        })
      ).rejects.toThrow('No valid auth state found');
    });

    it('throws when auth state is expired', async () => {
      // Write an expired auth file
      await writeFile(testAuthPath, JSON.stringify({ cookies: [], origins: [] }));
      const expiredTime = new Date(Date.now() - AUTH_TTL_MS - 60 * 60 * 1000);
      await utimes(testAuthPath, expiredTime, expiredTime);

      await expect(
        provisioner.createAgent({
          studioUrl: 'https://studio.atlassian.com/s/test/agents',
          config: {
            apiVersion: 'rovo.atlassian.com/v1',
            kind: 'StudioAgent',
            identity: {
              name: 'Test Agent',
              description: 'A test agent',
              behavior: 'Be helpful',
            },
            scenarios: {
              default: {
                instructions: 'Help the user',
              },
            },
          },
        })
      ).rejects.toThrow('No valid auth state found');
    });
  });
});
