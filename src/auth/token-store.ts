/**
 * Token storage with OS keychain as primary backend and filesystem fallback.
 *
 * Uses @napi-rs/keyring for macOS Keychain, Windows Credential Manager, and
 * Linux Secret Service (libsecret). Falls back to JSON files at
 * ~/.agentman/auth/ (permissions 0o600) when the keychain is unavailable
 * (e.g. headless CI, missing libsecret).
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getAuthDir } from '../config/paths.js';

const KEYRING_SERVICE = 'agent-manager';

export type TokenBackend = 'keychain' | 'filesystem';

export interface StoredTokens {
  /** The token sent as Bearer — ID token when available (required by Cognito authorisers), otherwise access token. */
  bearerToken: string;
  refreshToken?: string;
  /** ISO 8601 timestamp when the access token expires (if known). */
  expiresAt?: string;
  /** The OIDC discovery URL used to obtain these tokens. */
  oidcDiscoveryUrl: string;
  /** The client ID used. */
  clientId: string;
}

function keychainUser(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

function tokenFileName(baseUrl: string): string {
  const hostname = new URL(baseUrl).hostname.replace(/\./g, '_');
  return `${hostname}.json`;
}

// ── Keychain helpers ──────────────────────────────────────────────────────

let _keychainAvailable: boolean | undefined;

function getKeyringEntry(baseUrl: string) {
  if (_keychainAvailable === false) return null;
  try {
    // Use createRequire so the native addon resolves correctly under both
    // CJS (node dist/) and ESM-via-tsx (npm run dev) module modes.
    const esmRequire = createRequire(import.meta.url);
    const { Entry } = esmRequire('@napi-rs/keyring');
    _keychainAvailable = true;
    return new Entry(KEYRING_SERVICE, keychainUser(baseUrl));
  } catch {
    _keychainAvailable = false;
    return null;
  }
}

function tryKeychainLoad(baseUrl: string): StoredTokens | null {
  const entry = getKeyringEntry(baseUrl);
  if (!entry) return null;
  try {
    const raw = entry.getPassword();
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function tryKeychainSave(baseUrl: string, tokens: StoredTokens): boolean {
  const entry = getKeyringEntry(baseUrl);
  if (!entry) return false;
  try {
    entry.setPassword(JSON.stringify(tokens));
    return true;
  } catch {
    return false;
  }
}

function tryKeychainDelete(baseUrl: string): void {
  const entry = getKeyringEntry(baseUrl);
  if (!entry) return;
  try {
    entry.deletePassword();
  } catch {
    // Ignore — entry may not exist
  }
}

/** Reset the cached keychain availability flag (for testing). */
export function _resetKeychainCache(): void {
  _keychainAvailable = undefined;
}

/** Force the keychain to be treated as unavailable (for testing). */
export function _disableKeychain(): void {
  _keychainAvailable = false;
}

// ── Filesystem helpers ────────────────────────────────────────────────────

async function fsLoad(baseUrl: string): Promise<StoredTokens | null> {
  const filePath = path.join(getAuthDir(), tokenFileName(baseUrl));
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

async function fsSave(baseUrl: string, tokens: StoredTokens): Promise<void> {
  const dir = getAuthDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, tokenFileName(baseUrl));
  await writeFile(filePath, JSON.stringify(tokens, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

async function fsDelete(baseUrl: string): Promise<void> {
  const filePath = path.join(getAuthDir(), tokenFileName(baseUrl));
  try {
    await unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function loadTokens(baseUrl: string): Promise<StoredTokens | null> {
  return tryKeychainLoad(baseUrl) ?? await fsLoad(baseUrl);
}

export async function saveTokens(
  baseUrl: string,
  tokens: StoredTokens,
): Promise<TokenBackend> {
  if (tryKeychainSave(baseUrl, tokens)) {
    await fsDelete(baseUrl);
    return 'keychain';
  }
  await fsSave(baseUrl, tokens);
  return 'filesystem';
}

export async function deleteTokens(baseUrl: string): Promise<void> {
  tryKeychainDelete(baseUrl);
  await fsDelete(baseUrl);
}

export function isTokenExpired(
  tokens: StoredTokens,
  graceMs = 60_000,
): boolean {
  if (!tokens.expiresAt) return false;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  return Date.now() + graceMs >= expiresAt;
}
