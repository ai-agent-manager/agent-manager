/**
 * OAuth2 Authorization Code + PKCE flow orchestrator.
 *
 * Ties together OIDC discovery, PKCE, the callback server, and
 * token storage into a single high-level API.
 */

import { execFile } from 'node:child_process';
import { fetchOidcConfiguration, type OidcConfiguration } from './oidc.js';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';
import { waitForCallback, REDIRECT_URI } from './callback-server.js';
import {
  saveTokens,
  loadTokens,
  isTokenExpired,
  type StoredTokens,
  type TokenBackend,
} from './token-store.js';
import type { DiscoveryAuth } from '../discovery/types.js';
import { getPlatform } from '../lib/platform.js';

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
}

export interface AuthResult {
  /** The token to send as Bearer — prefers id_token (required by Cognito authorisers), falls back to access_token. */
  bearerToken: string;
  /** Whether the token was obtained from cache (true) or a fresh login (false). */
  fromCache: boolean;
  /** Where the token was persisted — 'keychain' (OS credential store) or 'filesystem' (~/.agentman/auth/). */
  backend?: TokenBackend;
}

export class AuthFlowError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'AuthFlowError';
  }
}

/** Thrown when the flow is cancelled via the abort signal, whichever stage the abort lands in. */
export class AuthCancelledError extends AuthFlowError {
  constructor() {
    super('Authentication cancelled');
    this.name = 'AuthCancelledError';
  }
}

export interface AuthenticateOptions {
  /** Cancels any in-flight stage (OIDC discovery, callback wait, token exchange/refresh). */
  signal?: AbortSignal;
}

/**
 * Obtain a valid access token for the given base URL.
 *
 * 1. Check for a cached token — if valid, return it.
 * 2. If expired but has a refresh token, attempt a refresh.
 * 3. Otherwise, run the full interactive authorization flow.
 *
 * @param baseUrl   The base URL of the discovery endpoint.
 * @param auth      The auth configuration from the discovery document.
 * @param onPrompt  Callback invoked with the authorization URL so the
 *                  TUI can display it to the user.
 * @param options   Optional abort signal covering every network stage.
 */
export async function authenticate(
  baseUrl: string,
  auth: DiscoveryAuth,
  onPrompt: (authorizeUrl: string) => void,
  options: AuthenticateOptions = {},
): Promise<AuthResult> {
  const { signal } = options;

  if (!auth.oidcDiscoveryUrl || !auth.clientId) {
    throw new AuthFlowError(
      'Discovery document requires authentication but is missing oidcDiscoveryUrl or clientId',
    );
  }

  if (signal?.aborted) throw new AuthCancelledError();

  // Check cached tokens first
  const cached = await loadTokens(baseUrl);
  if (cached && !isTokenExpired(cached)) {
    return { bearerToken: cached.bearerToken, fromCache: true };
  }

  try {
    // Fetch OIDC configuration
    const oidcConfig = await fetchOidcConfiguration(auth.oidcDiscoveryUrl, { signal });

    // Try refresh if we have a refresh token
    if (cached?.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(
          oidcConfig,
          auth.clientId,
          cached.refreshToken,
          signal,
        );
        const tokens = toStoredTokens(refreshed, auth);
        const backend = await saveTokens(baseUrl, tokens);
        return { bearerToken: tokens.bearerToken, fromCache: false, backend };
      } catch (err) {
        // A cancelled refresh must not fall through and start an interactive
        // login the user just cancelled — rethrow for the outer normalizer.
        if (signal?.aborted) throw err;
        // Refresh failed — fall through to interactive login
      }
    }

    // Full interactive authorization code flow
    return await interactiveLogin(baseUrl, auth, oidcConfig, onPrompt, signal);
  } catch (err) {
    // Whichever stage the abort interrupted (each surfaces it differently —
    // AbortError from fetch, CallbackServerError from the callback wait),
    // callers see one normalized cancellation error.
    if (signal?.aborted) throw new AuthCancelledError();
    throw err;
  }
}

/**
 * Run the interactive Authorization Code + PKCE flow.
 */
async function interactiveLogin(
  baseUrl: string,
  auth: DiscoveryAuth,
  oidcConfig: OidcConfiguration,
  onPrompt: (authorizeUrl: string) => void,
  signal?: AbortSignal,
): Promise<AuthResult> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const scopes = auth.scopes ?? ['openid'];

  const params = new URLSearchParams({
    client_id: auth.clientId!,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authorizeUrl = `${oidcConfig.authorization_endpoint}?${params.toString()}`;

  // Notify the TUI so it can display the URL
  onPrompt(authorizeUrl);

  // Wait for the callback
  const { code } = await waitForCallback(state, { signal });

  // Exchange code for tokens — still abortable: the inline prompt stays
  // visible while this fetch runs, so cancel must cover it too.
  const tokenResponse = await exchangeCode(
    oidcConfig,
    auth.clientId!,
    code,
    codeVerifier,
    signal,
  );

  const tokens = toStoredTokens(tokenResponse, auth);
  const backend = await saveTokens(baseUrl, tokens);

  return { bearerToken: tokens.bearerToken, fromCache: false, backend };
}

/**
 * Exchange an authorization code for tokens.
 */
async function exchangeCode(
  oidcConfig: OidcConfiguration,
  clientId: string,
  code: string,
  codeVerifier: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(oidcConfig.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AuthFlowError(
      `Token exchange failed (HTTP ${response.status}): ${text}`,
    );
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Use a refresh token to obtain a new access token.
 */
async function refreshAccessToken(
  oidcConfig: OidcConfiguration,
  clientId: string,
  refreshToken: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(oidcConfig.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    throw new AuthFlowError(
      `Token refresh failed (HTTP ${response.status})`,
    );
  }

  return (await response.json()) as TokenResponse;
}

/**
 * Convert a token response to the stored format.
 */
function toStoredTokens(
  response: TokenResponse,
  auth: DiscoveryAuth,
): StoredTokens {
  const tokens: StoredTokens = {
    bearerToken: response.id_token ?? response.access_token,
    oidcDiscoveryUrl: auth.oidcDiscoveryUrl!,
    clientId: auth.clientId!,
  };

  if (response.refresh_token) {
    tokens.refreshToken = response.refresh_token;
  }

  if (response.expires_in) {
    tokens.expiresAt = new Date(
      Date.now() + response.expires_in * 1000,
    ).toISOString();
  }

  return tokens;
}

/**
 * Open a URL in the user's default browser.
 */
export function openInBrowser(url: string): void {
  const platform = getPlatform();
  const cmd =
    platform === 'macos'
      ? 'open'
      : platform === 'windows'
        ? 'start'
        : 'xdg-open';

  execFile(cmd, [url], { shell: false });
}
