import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { StoredTokens } from '../../../src/auth/token-store.js';

let tempDir: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAuthDir: () => tempDir,
}));

const {
  loadTokens,
  saveTokens,
  deleteTokens,
  isTokenExpired,
  _resetKeychainCache,
  _disableKeychain,
} = await import('../../../src/auth/token-store.js');

const sampleTokens: StoredTokens = {
  bearerToken: 'bearer-123',
  refreshToken: 'refresh-456',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
  clientId: 'test-client',
};

describe('token-store', () => {
  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `token-store-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    _resetKeychainCache();
  });

  afterEach(async () => {
    // Clean up any keychain entries created during tests
    try { await deleteTokens('https://example.com'); } catch {}
    try { await deleteTokens('https://api.sub.example.com/path'); } catch {}
    _resetKeychainCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Keychain backend ──────────────────────────────────────────────────

  describe('keychain backend', () => {
    it('saves to and loads from the OS keychain', async () => {
      const backend = await saveTokens('https://example.com', sampleTokens);
      expect(backend).toBe('keychain');

      const loaded = await loadTokens('https://example.com');
      expect(loaded).toEqual(sampleTokens);
    });

    it('cleans up filesystem tokens when keychain save succeeds', async () => {
      // Write a filesystem token first
      const filePath = path.join(tempDir, 'example_com.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, JSON.stringify(sampleTokens));

      await saveTokens('https://example.com', sampleTokens);

      await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
    });

    it('deletes from the OS keychain', async () => {
      await saveTokens('https://example.com', sampleTokens);
      await deleteTokens('https://example.com');

      const loaded = await loadTokens('https://example.com');
      expect(loaded).toBeNull();
    });
  });

  // ── Filesystem fallback ───────────────────────────────────────────────

  describe('filesystem fallback', () => {
    beforeEach(() => {
      _disableKeychain();
    });

    it('falls back to filesystem when keychain is unavailable', async () => {
      const backend = await saveTokens('https://example.com', sampleTokens);
      expect(backend).toBe('filesystem');

      const loaded = await loadTokens('https://example.com');
      expect(loaded).toEqual(sampleTokens);
    });

    it('stores tokens as JSON with restricted permissions', async () => {
      await saveTokens('https://example.com', sampleTokens);

      const filePath = path.join(tempDir, 'example_com.json');
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.bearerToken).toBe('bearer-123');
    });

    it('uses hostname-based filenames (dots to underscores)', async () => {
      await saveTokens('https://api.sub.example.com/path', sampleTokens);

      const filePath = path.join(tempDir, 'api_sub_example_com.json');
      const raw = await readFile(filePath, 'utf-8');
      expect(JSON.parse(raw).bearerToken).toBe('bearer-123');
    });

    it('returns null when no tokens are stored', async () => {
      const result = await loadTokens('https://nonexistent.example.com');
      expect(result).toBeNull();
    });

    it('does not throw when deleting non-existent tokens', async () => {
      await expect(
        deleteTokens('https://nonexistent.example.com'),
      ).resolves.toBeUndefined();
    });
  });

  // ── Fallback from keychain to filesystem on load ──────────────────────

  describe('load fallback', () => {
    it('loads from filesystem when keychain has no entry', async () => {
      // Write directly to filesystem (bypassing keychain)
      _disableKeychain();
      await saveTokens('https://example.com', sampleTokens);

      // Re-enable keychain — keychain has nothing, should fall back to filesystem
      _resetKeychainCache();
      const loaded = await loadTokens('https://example.com');
      expect(loaded).toEqual(sampleTokens);
    });
  });

  // ── isTokenExpired ────────────────────────────────────────────────────

  describe('isTokenExpired', () => {
    it('returns false for a token with no expiresAt', () => {
      expect(isTokenExpired({ ...sampleTokens, expiresAt: undefined })).toBe(false);
    });

    it('returns false for a token expiring in the future', () => {
      expect(isTokenExpired({
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      })).toBe(false);
    });

    it('returns true for an expired token', () => {
      expect(isTokenExpired({
        ...sampleTokens,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })).toBe(true);
    });

    it('returns true when token is within the grace period', () => {
      expect(isTokenExpired({
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      })).toBe(true);
    });

    it('respects custom grace period', () => {
      expect(isTokenExpired({
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }, 10_000)).toBe(false);
    });
  });
});
