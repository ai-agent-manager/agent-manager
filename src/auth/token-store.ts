/**
 * Token storage backed by the filesystem at ~/.agentman/auth/.
 *
 * Tokens are stored as JSON files keyed by the domain of the base URL.
 * File permissions are restricted to the owning user (0o600).
 *
 * NOTE: This is filesystem-based storage — not a system keychain.
 * A warning is emitted when tokens are first written.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getAuthDir } from '../config/paths.js';

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** ISO 8601 timestamp when the access token expires (if known). */
  expiresAt?: string;
  /** The OIDC discovery URL used to obtain these tokens. */
  oidcDiscoveryUrl: string;
  /** The client ID used. */
  clientId: string;
}

/**
 * Derive a stable filename from a base URL.
 * Uses the hostname (dots replaced with underscores) to avoid path issues.
 */
function tokenFileName(baseUrl: string): string {
  const hostname = new URL(baseUrl).hostname.replace(/\./g, '_');
  return `${hostname}.json`;
}

/**
 * Load stored tokens for a given base URL.
 * Returns `null` if no tokens are stored.
 */
export async function loadTokens(baseUrl: string): Promise<StoredTokens | null> {
  const filePath = path.join(getAuthDir(), tokenFileName(baseUrl));
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

/**
 * Save tokens for a given base URL.
 * Creates the auth directory if it doesn't exist.
 * Restricts file permissions to owner-only (0o600).
 */
export async function saveTokens(
  baseUrl: string,
  tokens: StoredTokens,
): Promise<void> {
  const dir = getAuthDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const filePath = path.join(dir, tokenFileName(baseUrl));
  await writeFile(filePath, JSON.stringify(tokens, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  // TODO: Replace with OS keychain storage (macOS Keychain / Windows Credential Manager / libsecret)
  // with filesystem as fallback. See issue #11.
}

/**
 * Delete stored tokens for a given base URL.
 */
export async function deleteTokens(baseUrl: string): Promise<void> {
  const filePath = path.join(getAuthDir(), tokenFileName(baseUrl));
  try {
    await unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check whether the stored access token has expired (or is about to
 * expire within the given grace period).
 */
export function isTokenExpired(
  tokens: StoredTokens,
  graceMs = 60_000,
): boolean {
  if (!tokens.expiresAt) return false; // No expiry info — assume valid
  const expiresAt = new Date(tokens.expiresAt).getTime();
  return Date.now() + graceMs >= expiresAt;
}
