/**
 * Lazy, origin-scoped access-token provisioning for protected content URLs.
 *
 * Authentication happens at the protected operation boundary — the moment an
 * update actually needs a token — never at screen entry, so read-only flows
 * are never gated behind an interactive login and the token is validated or
 * refreshed immediately before the download that uses it.
 */

import { authenticate } from './flow.js';
import { isOriginInDiscovery } from '../discovery/token-scope.js';
import type { DiscoveryDocument } from '../discovery/types.js';

export interface InteractiveAuthOptions {
  /**
   * Shows the authorization URL when interactive login is required.
   * Required: a caller that cannot render the prompt must not call the
   * provider, or the user would silently wait out the callback timeout.
   */
  onAuthPrompt: (authorizeUrl: string) => void;
  /** Cancels any in-flight authentication stage. Required for the same reason. */
  signal: AbortSignal;
}

/** UI-layer provider: interactive capabilities are mandatory, not optional. */
export type InteractiveAccessTokenProvider = (
  contentUrl: string,
  options: InteractiveAuthOptions,
) => Promise<string | undefined>;

export interface DiscoveryAuthContext {
  /** Discovery endpoint base URL — the token-cache key. */
  baseUrl: string;
  document: DiscoveryDocument;
}

/**
 * Build a provider that releases a bearer token only for content URLs whose
 * origin the active discovery document declares (see isOriginInDiscovery).
 * Origin eligibility is checked before authenticating, so a foreign URL can
 * never trigger a login prompt. Cache hits return without network I/O, which
 * is what makes authenticating per-request affordable.
 */
export function createDiscoveryAccessTokenProvider(
  context: DiscoveryAuthContext | null,
): InteractiveAccessTokenProvider {
  return async (contentUrl, { onAuthPrompt, signal }) => {
    if (!context?.document.auth?.required) return undefined;
    if (!isOriginInDiscovery(context.document, contentUrl)) return undefined;

    const result = await authenticate(context.baseUrl, context.document.auth, onAuthPrompt, {
      signal,
      interactiveMode: true,
      requestUrl: contentUrl,
    });
    return result.bearerToken;
  };
}
