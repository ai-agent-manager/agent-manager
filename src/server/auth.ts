import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Generate a cryptographically random auth token for the server session.
 * Uses crypto.randomUUID() which produces a v4 UUID (122 bits of randomness).
 */
export function generateToken(): string {
  return randomUUID();
}

/**
 * Extract the Bearer token from an HTTP request's Authorization header.
 * Returns `null` if the header is missing or malformed.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/**
 * Validate that the request carries the correct auth token.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Returns `true` if the token matches, `false` otherwise.
 */
export function isAuthorised(req: IncomingMessage, expectedToken: string): boolean {
  const token = extractBearerToken(req);
  if (!token) return false;

  // Both are UUIDs so should always be 36 chars, but guard against
  // variable-length inputs to avoid leaking length information.
  if (token.length !== expectedToken.length) return false;

  const a = Buffer.from(token, 'utf-8');
  const b = Buffer.from(expectedToken, 'utf-8');
  return timingSafeEqual(a, b);
}
