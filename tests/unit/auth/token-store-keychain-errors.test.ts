import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { StoredTokens, TokenStoreIdentity } from '../../../src/auth/token-store.js';

// @napi-rs/keyring 2.x throws on store failures (locked keychain, access
// denied) instead of returning null/false. This fake Entry throws from every
// method so the filesystem fallback paths are exercised.
const keychainError = new Error('Platform secure storage failure: keychain is locked');

class ThrowingEntry {
  getPassword(): string | null {
    throw keychainError;
  }
  setPassword(): void {
    throw keychainError;
  }
  deletePassword(): boolean {
    throw keychainError;
  }
}

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const real = actual.createRequire(url);
      return Object.assign((id: string) => {
        if (id === '@napi-rs/keyring') return { Entry: ThrowingEntry };
        return real(id);
      }, real);
    },
  };
});

let tempDir: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAuthDir: () => tempDir,
}));

const { loadTokens, saveTokens, deleteTokens, tokenStorageKey, _resetKeychainCache } =
  await import('../../../src/auth/token-store.js');

const identity: TokenStoreIdentity = {
  discoveryBaseUrl: 'https://example.com',
  oidcDiscoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
  clientId: 'test-client',
};

const tokens: StoredTokens = {
  bearerToken: 'bearer-123',
  oidcDiscoveryUrl: identity.oidcDiscoveryUrl,
  clientId: identity.clientId,
};

describe('token-store when the OS keychain throws', () => {
  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `token-store-keychain-errors-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    _resetKeychainCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('saves to the filesystem when setPassword throws', async () => {
    await expect(saveTokens(identity, tokens)).resolves.toBe('filesystem');
    expect(await readdir(tempDir)).toEqual([`${tokenStorageKey(identity)}.json`]);
  });

  it('loads from the filesystem when getPassword throws', async () => {
    await writeFile(
      path.join(tempDir, `${tokenStorageKey(identity)}.json`),
      JSON.stringify(tokens),
    );
    await expect(loadTokens(identity)).resolves.toEqual(tokens);
  });

  it('still removes filesystem tokens when deletePassword throws', async () => {
    await writeFile(
      path.join(tempDir, `${tokenStorageKey(identity)}.json`),
      JSON.stringify(tokens),
    );
    await expect(deleteTokens(identity)).resolves.toBeUndefined();
    expect(await readdir(tempDir)).toEqual([]);
  });
});
