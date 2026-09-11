/**
 * Token storage with OS keychain as primary backend and filesystem fallback.
 *
 * Uses @napi-rs/keyring for macOS Keychain, Windows Credential Manager, and
 * Linux Secret Service (libsecret). Falls back to JSON files at
 * ~/.agentman/auth/ (permissions 0o600) when the keychain is unavailable
 * (e.g. headless CI, missing libsecret).
 *
 * Entries are keyed by a SHA-256 hash of the discovery base URL plus the OIDC
 * discovery URL and client ID, so catalogues that share a hostname (or the same
 * catalogue with a different IdP) never reuse each other's tokens.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getAuthDir } from '../config/paths.js';

const KEYRING_SERVICE = 'agent-manager';

export type TokenBackend = 'keychain' | 'filesystem';

/** Identity that uniquely selects a stored auth session. */
export interface TokenStoreIdentity {
  /** Discovery catalogue base URL (scheme + host + path). */
  discoveryBaseUrl: string;
  /** OIDC discovery document URL from the catalogue's auth config. */
  oidcDiscoveryUrl: string;
  /** OAuth client ID from the catalogue's auth config. */
  clientId: string;
}

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

/**
 * Normalise a discovery catalogue base URL for the storage key: host is
 * lowercased by the URL parser, trailing slash on the path is stripped,
 * query and hash are dropped.
 *
 * Pathname case is preserved deliberately — `/Org/Repo` and `/org/repo` are
 * distinct keys. Callers that treat paths as case-insensitive must normalise
 * case before building a {@link TokenStoreIdentity}.
 */
export function normalizeAuthUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname === '/') {
    pathname = '';
  }
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

/**
 * Normalise an OIDC discovery URL for the storage key and identity checks.
 *
 * Host is lowercased; the pathname (including a trailing slash) and query
 * string are preserved so distinct discovery documents (for example different
 * `tenant=` query values, or `/discovery` vs `/discovery/`) never share a
 * session. Only the hash fragment is dropped.
 */
export function normalizeOidcDiscoveryUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
}

/**
 * Stable storage key (hex SHA-256) for keychain account names and filenames.
 * Includes discovery base URL, IdP discovery URL, and client ID.
 */
export function tokenStorageKey(identity: TokenStoreIdentity): string {
  const material = [
    normalizeAuthUrl(identity.discoveryBaseUrl),
    normalizeOidcDiscoveryUrl(identity.oidcDiscoveryUrl),
    identity.clientId.trim(),
  ].join('\n');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

function keychainUser(identity: TokenStoreIdentity): string {
  return tokenStorageKey(identity);
}

function tokenFileName(identity: TokenStoreIdentity): string {
  return `${tokenStorageKey(identity)}.json`;
}

// ── Keychain helpers ──────────────────────────────────────────────────────

let _keychainAvailable: boolean | undefined;

function getKeyringEntry(identity: TokenStoreIdentity) {
  if (_keychainAvailable === false) return null;
  try {
    // Use createRequire so the native addon resolves correctly under both
    // CJS (node dist/) and ESM-via-tsx (npm run dev) module modes.
    const esmRequire = createRequire(import.meta.url);
    const { Entry } = esmRequire('@napi-rs/keyring');
    _keychainAvailable = true;
    return new Entry(KEYRING_SERVICE, keychainUser(identity));
  } catch {
    _keychainAvailable = false;
    return null;
  }
}

function tryKeychainLoad(identity: TokenStoreIdentity): StoredTokens | null {
  const entry = getKeyringEntry(identity);
  if (!entry) return null;
  try {
    const raw = entry.getPassword();
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function tryKeychainSave(identity: TokenStoreIdentity, tokens: StoredTokens): boolean {
  const entry = getKeyringEntry(identity);
  if (!entry) return false;
  try {
    entry.setPassword(JSON.stringify(tokens));
    return true;
  } catch {
    return false;
  }
}

function tryKeychainDelete(identity: TokenStoreIdentity): void {
  const entry = getKeyringEntry(identity);
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

async function fsLoad(identity: TokenStoreIdentity): Promise<StoredTokens | null> {
  const filePath = path.join(getAuthDir(), tokenFileName(identity));
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

async function fsSave(identity: TokenStoreIdentity, tokens: StoredTokens): Promise<void> {
  const dir = getAuthDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, tokenFileName(identity));
  await writeFile(filePath, JSON.stringify(tokens, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

async function fsDelete(identity: TokenStoreIdentity): Promise<void> {
  const filePath = path.join(getAuthDir(), tokenFileName(identity));
  try {
    await unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

// ── Public API ────────────────────────────────────────────────────────────

export async function loadTokens(
  identity: TokenStoreIdentity,
): Promise<StoredTokens | null> {
  return tryKeychainLoad(identity) ?? (await fsLoad(identity));
}

export async function saveTokens(
  identity: TokenStoreIdentity,
  tokens: StoredTokens,
): Promise<TokenBackend> {
  if (!tokensMatchIdentity(tokens, identity)) {
    throw new Error(
      'Refusing to store tokens whose oidcDiscoveryUrl or clientId do not match the storage identity',
    );
  }
  if (tryKeychainSave(identity, tokens)) {
    await fsDelete(identity);
    return 'keychain';
  }
  await fsSave(identity, tokens);
  return 'filesystem';
}

export async function deleteTokens(identity: TokenStoreIdentity): Promise<void> {
  tryKeychainDelete(identity);
  await fsDelete(identity);
}

export function isTokenExpired(
  tokens: StoredTokens,
  graceMs = 60_000,
): boolean {
  if (!tokens.expiresAt) return false;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  return Date.now() + graceMs >= expiresAt;
}

/** True when stored tokens were issued for the given IdP / client. */
export function tokensMatchIdentity(
  tokens: StoredTokens,
  identity: TokenStoreIdentity,
): boolean {
  try {
    return (
      normalizeOidcDiscoveryUrl(tokens.oidcDiscoveryUrl) ===
        normalizeOidcDiscoveryUrl(identity.oidcDiscoveryUrl) &&
      tokens.clientId.trim() === identity.clientId.trim()
    );
  } catch {
    return false;
  }
}
