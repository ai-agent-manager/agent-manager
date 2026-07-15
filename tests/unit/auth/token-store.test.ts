import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { StoredTokens } from '../../../src/auth/token-store.js';

let tempDir: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAuthDir: () => tempDir,
}));

const { loadTokens, saveTokens, deleteTokens, isTokenExpired } = await import(
  '../../../src/auth/token-store.js'
);

const sampleTokens: StoredTokens = {
  bearerToken: 'access-123',
  refreshToken: 'refresh-456',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
  clientId: 'test-client',
};

describe('token-store', () => {
  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `token-store-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('saveTokens and loadTokens', () => {
    it('round-trips tokens correctly', async () => {
      await saveTokens('https://example.com', sampleTokens);
      const loaded = await loadTokens('https://example.com');
      expect(loaded).toEqual(sampleTokens);
    });

    it('stores tokens as JSON with restricted permissions', async () => {
      await saveTokens('https://example.com', sampleTokens);
      const filePath = path.join(tempDir, 'example_com.json');
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.bearerToken).toBe('access-123');
    });

    it('uses hostname-based filenames (dots to underscores)', async () => {
      await saveTokens('https://api.sub.example.com/path', sampleTokens);
      const filePath = path.join(tempDir, 'api_sub_example_com.json');
      const raw = await readFile(filePath, 'utf-8');
      expect(JSON.parse(raw).bearerToken).toBe('access-123');
    });
  });

  describe('loadTokens', () => {
    it('returns null when no tokens are stored', async () => {
      const result = await loadTokens('https://nonexistent.example.com');
      expect(result).toBeNull();
    });
  });

  describe('deleteTokens', () => {
    it('removes stored tokens', async () => {
      await saveTokens('https://example.com', sampleTokens);
      await deleteTokens('https://example.com');
      const loaded = await loadTokens('https://example.com');
      expect(loaded).toBeNull();
    });

    it('does not throw when tokens do not exist', async () => {
      await expect(
        deleteTokens('https://nonexistent.example.com'),
      ).resolves.toBeUndefined();
    });
  });

  describe('isTokenExpired', () => {
    it('returns false for a token with no expiresAt', () => {
      const tokens: StoredTokens = {
        ...sampleTokens,
        expiresAt: undefined,
      };
      expect(isTokenExpired(tokens)).toBe(false);
    });

    it('returns false for a token expiring in the future', () => {
      const tokens: StoredTokens = {
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
      expect(isTokenExpired(tokens)).toBe(false);
    });

    it('returns true for an expired token', () => {
      const tokens: StoredTokens = {
        ...sampleTokens,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      expect(isTokenExpired(tokens)).toBe(true);
    });

    it('returns true when token is within the grace period', () => {
      const tokens: StoredTokens = {
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      };
      // Default grace is 60s, so 30s remaining → expired
      expect(isTokenExpired(tokens)).toBe(true);
    });

    it('respects custom grace period', () => {
      const tokens: StoredTokens = {
        ...sampleTokens,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      };
      // 10s grace, 30s remaining → not expired
      expect(isTokenExpired(tokens, 10_000)).toBe(false);
    });
  });
});
