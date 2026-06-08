/**
 * PKCE (Proof Key for Code Exchange) utilities for OAuth2.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate a cryptographically random code verifier (43–128 characters,
 * unreserved URI characters).
 */
export function generateCodeVerifier(length = 64): string {
  // Generate random bytes and base64url-encode them
  const bytes = randomBytes(length);
  return bytes
    .toString('base64url')
    .slice(0, length);
}

/**
 * Derive the S256 code challenge from a code verifier.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64url');
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}
