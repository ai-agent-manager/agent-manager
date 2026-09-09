import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { StoredTokens, TokenStoreIdentity } from '../../../src/auth/token-store.js';

let tempDir: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAuthDir: () => tempDir,
}));

const {
  loadTokens,
  saveTokens,
  deleteTokens,
  isTokenExpired,
  normalizeAuthUrl,
  normalizeOidcDiscoveryUrl,
  tokenStorageKey,
  tokensMatchIdentity,
  _resetKeychainCache,
  _disableKeychain,
} = await import('../../../src/auth/token-store.js');

const sampleIdentity: TokenStoreIdentity = {
  discoveryBaseUrl: 'https://example.com',
  oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
  clientId: 'test-client',
};

const sampleTokens: StoredTokens = {
  bearerToken: 'bearer-123',
  refreshToken: 'refresh-456',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
  clientId: sampleIdentity.clientId,
};

const pathIdentity: TokenStoreIdentity = {
  discoveryBaseUrl: 'https://api.sub.example.com/path',
  oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
  clientId: sampleIdentity.clientId,
};

// Detect at module load time whether the native keychain addon is present.
// Tests that require the OS keychain are skipped when it's unavailable (e.g. CI,
// machines without @napi-rs/keyring installed).
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
let keychainAvailable: boolean;
try {
  _require('@napi-rs/keyring');
  keychainAvailable = true;
} catch {
  keychainAvailable = false;
}

describe('token-store', () => {
  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `token-store-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    _resetKeychainCache();
  });

  afterEach(async () => {
    // Clean up any keychain entries created during tests
    try { await deleteTokens(sampleIdentity); } catch {}
    try { await deleteTokens(pathIdentity); } catch {}
    _resetKeychainCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('normalizeAuthUrl / tokenStorageKey', () => {
    it('strips trailing slashes, query, and hash from catalogue base URLs', () => {
      expect(normalizeAuthUrl('https://Example.com/foo/')).toBe('https://example.com/foo');
      expect(normalizeAuthUrl('https://example.com/')).toBe('https://example.com');
      expect(normalizeAuthUrl('https://example.com?x=1#y')).toBe('https://example.com');
    });

    it('preserves OIDC pathname trailing slash and query, dropping only the hash', () => {
      expect(
        normalizeOidcDiscoveryUrl(
          'https://IdP.example.com/discovery?tenant=first#frag',
        ),
      ).toBe('https://idp.example.com/discovery?tenant=first');
      expect(
        normalizeOidcDiscoveryUrl('https://idp.example.com/discovery/'),
      ).toBe('https://idp.example.com/discovery/');
      expect(
        normalizeOidcDiscoveryUrl('https://idp.example.com/discovery'),
      ).toBe('https://idp.example.com/discovery');
    });

    it('produces distinct keys for different catalogue paths on the same host', () => {
      const a = tokenStorageKey({
        discoveryBaseUrl: 'https://github.com/acme/catalog',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: 'cli',
      });
      const b = tokenStorageKey({
        discoveryBaseUrl: 'https://github.com/attacker/cool',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: 'cli',
      });
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces distinct keys when IdP or clientId differs', () => {
      const base = {
        discoveryBaseUrl: 'https://example.com',
        oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
        clientId: 'cli-a',
      };
      expect(tokenStorageKey(base)).not.toBe(
        tokenStorageKey({ ...base, clientId: 'cli-b' }),
      );
      expect(tokenStorageKey(base)).not.toBe(
        tokenStorageKey({
          ...base,
          oidcDiscoveryUrl: 'https://other-idp.example.com/.well-known/openid-configuration',
        }),
      );
    });

    it('treats equivalent catalogue URL normalisations as the same key', () => {
      const a = tokenStorageKey({
        discoveryBaseUrl: 'https://example.com/catalog/',
        oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
        clientId: 'cli',
      });
      const b = tokenStorageKey({
        discoveryBaseUrl: 'https://example.com/catalog',
        oidcDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
        clientId: 'cli',
      });
      expect(a).toBe(b);
    });

    it('produces distinct keys for OIDC query or trailing-slash differences', () => {
      const base = {
        discoveryBaseUrl: 'https://catalogue.example.com',
        clientId: 'cli',
      };
      const tenantFirst = tokenStorageKey({
        ...base,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=first',
      });
      const tenantSecond = tokenStorageKey({
        ...base,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=second',
      });
      const withSlash = tokenStorageKey({
        ...base,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery/',
      });
      const withoutSlash = tokenStorageKey({
        ...base,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery',
      });
      expect(tenantFirst).not.toBe(tenantSecond);
      expect(withSlash).not.toBe(withoutSlash);
    });

    it('preserves pathname case so differently cased paths are distinct keys', () => {
      const mixed = tokenStorageKey({
        discoveryBaseUrl: 'https://github.com/Org/Repo',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: 'cli',
      });
      const lower = tokenStorageKey({
        discoveryBaseUrl: 'https://github.com/org/repo',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: 'cli',
      });
      expect(mixed).not.toBe(lower);
      expect(normalizeAuthUrl('https://github.com/Org/Repo')).toBe(
        'https://github.com/Org/Repo',
      );
    });
  });

  describe('tokensMatchIdentity', () => {
    it('returns true when IdP and client match', () => {
      expect(tokensMatchIdentity(sampleTokens, sampleIdentity)).toBe(true);
    });

    it('returns false when IdP or client differs', () => {
      expect(
        tokensMatchIdentity(sampleTokens, {
          ...sampleIdentity,
          clientId: 'other',
        }),
      ).toBe(false);
      expect(
        tokensMatchIdentity(sampleTokens, {
          ...sampleIdentity,
          oidcDiscoveryUrl: 'https://other.example.com/.well-known/openid-configuration',
        }),
      ).toBe(false);
    });

    it('returns false when OIDC query or trailing slash differs', () => {
      const tokens = {
        ...sampleTokens,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=first',
      };
      expect(
        tokensMatchIdentity(tokens, {
          ...sampleIdentity,
          oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=second',
        }),
      ).toBe(false);
      expect(
        tokensMatchIdentity(
          { ...sampleTokens, oidcDiscoveryUrl: 'https://idp.example.com/discovery/' },
          {
            ...sampleIdentity,
            oidcDiscoveryUrl: 'https://idp.example.com/discovery',
          },
        ),
      ).toBe(false);
    });
  });

  // ── Keychain backend ──────────────────────────────────────────────────

  describe('keychain backend', () => {
    it.skipIf(!keychainAvailable)('saves to and loads from the OS keychain', async () => {
      const backend = await saveTokens(sampleIdentity, sampleTokens);
      expect(backend).toBe('keychain');

      const loaded = await loadTokens(sampleIdentity);
      expect(loaded).toEqual(sampleTokens);
    });

    it.skipIf(!keychainAvailable)('cleans up filesystem tokens when keychain save succeeds', async () => {
      const filePath = path.join(tempDir, `${tokenStorageKey(sampleIdentity)}.json`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filePath, JSON.stringify(sampleTokens));

      await saveTokens(sampleIdentity, sampleTokens);

      await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
    });

    it.skipIf(!keychainAvailable)('deletes from the OS keychain', async () => {
      await saveTokens(sampleIdentity, sampleTokens);
      await deleteTokens(sampleIdentity);

      const loaded = await loadTokens(sampleIdentity);
      expect(loaded).toBeNull();
    });
  });

  // ── Filesystem fallback ───────────────────────────────────────────────

  describe('filesystem fallback', () => {
    beforeEach(() => {
      _disableKeychain();
    });

    it('falls back to filesystem when keychain is unavailable', async () => {
      const backend = await saveTokens(sampleIdentity, sampleTokens);
      expect(backend).toBe('filesystem');

      const loaded = await loadTokens(sampleIdentity);
      expect(loaded).toEqual(sampleTokens);
    });

    it('stores tokens as JSON with restricted permissions', async () => {
      await saveTokens(sampleIdentity, sampleTokens);

      const filePath = path.join(tempDir, `${tokenStorageKey(sampleIdentity)}.json`);
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.bearerToken).toBe('bearer-123');
    });

    it('uses hashed filenames, not hostname-only names', async () => {
      await saveTokens(pathIdentity, sampleTokens);

      const files = await readdir(tempDir);
      expect(files).toEqual([`${tokenStorageKey(pathIdentity)}.json`]);
      expect(files[0]).not.toContain('api_sub_example_com');
    });

    it('does not share tokens across catalogues on the same host', async () => {
      const other: TokenStoreIdentity = {
        discoveryBaseUrl: 'https://api.sub.example.com/other',
        oidcDiscoveryUrl: pathIdentity.oidcDiscoveryUrl,
        clientId: pathIdentity.clientId,
      };
      await saveTokens(pathIdentity, sampleTokens);

      expect(await loadTokens(other)).toBeNull();
      expect(await loadTokens(pathIdentity)).toEqual(sampleTokens);
    });

    it('does not share tokens across differently cased catalogue paths', async () => {
      const mixedCase: TokenStoreIdentity = {
        discoveryBaseUrl: 'https://github.com/Org/Repo',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: sampleIdentity.clientId,
      };
      const lowerCase: TokenStoreIdentity = {
        discoveryBaseUrl: 'https://github.com/org/repo',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: sampleIdentity.clientId,
      };

      await saveTokens(mixedCase, sampleTokens);

      expect(await loadTokens(lowerCase)).toBeNull();
      expect(await loadTokens(mixedCase)).toEqual(sampleTokens);
      const files = await readdir(tempDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${tokenStorageKey(mixedCase)}.json`);
      expect(files[0]).not.toBe(`${tokenStorageKey(lowerCase)}.json`);
    });

    it('does not share tokens across OIDC query or trailing-slash variants', async () => {
      const tenantFirst: TokenStoreIdentity = {
        discoveryBaseUrl: 'https://catalogue.example.com',
        oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=first',
        clientId: sampleIdentity.clientId,
      };
      const tenantSecond: TokenStoreIdentity = {
        ...tenantFirst,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery?tenant=second',
      };
      const withSlash: TokenStoreIdentity = {
        discoveryBaseUrl: 'https://catalogue.example.com',
        oidcDiscoveryUrl: 'https://idp.example.com/discovery/',
        clientId: sampleIdentity.clientId,
      };
      const withoutSlash: TokenStoreIdentity = {
        ...withSlash,
        oidcDiscoveryUrl: 'https://idp.example.com/discovery',
      };

      const firstTokens = {
        ...sampleTokens,
        oidcDiscoveryUrl: tenantFirst.oidcDiscoveryUrl,
      };
      const slashTokens = {
        ...sampleTokens,
        oidcDiscoveryUrl: withSlash.oidcDiscoveryUrl,
      };

      await saveTokens(tenantFirst, firstTokens);
      expect(await loadTokens(tenantSecond)).toBeNull();
      expect(await loadTokens(tenantFirst)).toEqual(firstTokens);

      await saveTokens(withSlash, slashTokens);
      expect(await loadTokens(withoutSlash)).toBeNull();
      expect(await loadTokens(withSlash)).toEqual(slashTokens);
    });

    it('rejects saves whose token IdP or clientId do not match the identity', async () => {
      await expect(
        saveTokens(sampleIdentity, {
          ...sampleTokens,
          clientId: 'other-client',
        }),
      ).rejects.toThrow(/do not match the storage identity/i);

      await expect(
        saveTokens(sampleIdentity, {
          ...sampleTokens,
          oidcDiscoveryUrl: 'https://other.example.com/.well-known/openid-configuration',
        }),
      ).rejects.toThrow(/do not match the storage identity/i);

      const files = await readdir(tempDir);
      expect(files).toEqual([]);
    });

    it('returns null when no tokens are stored', async () => {
      const result = await loadTokens({
        discoveryBaseUrl: 'https://nonexistent.example.com',
        oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
        clientId: sampleIdentity.clientId,
      });
      expect(result).toBeNull();
    });

    it('does not throw when deleting non-existent tokens', async () => {
      await expect(
        deleteTokens({
          discoveryBaseUrl: 'https://nonexistent.example.com',
          oidcDiscoveryUrl: sampleIdentity.oidcDiscoveryUrl,
          clientId: sampleIdentity.clientId,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Fallback from keychain to filesystem on load ──────────────────────

  describe('load fallback', () => {
    it('loads from filesystem when keychain has no entry', async () => {
      _disableKeychain();
      await saveTokens(sampleIdentity, sampleTokens);

      _resetKeychainCache();
      const loaded = await loadTokens(sampleIdentity);
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
