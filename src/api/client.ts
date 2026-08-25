/**
 * Thin authenticated HTTP client for the publisher REST API.
 *
 * The base URL is resolved from `API_BASE_URL` (env) or `discovery.api.baseUrl`
 * — never hardcoded in application code.
 *
 * Bearer tokens are resolved via {@link getValidBearerToken} immediately before
 * each request (with a single force-refresh retry on HTTP 401).
 */

import { getValidBearerToken, type AuthSession } from '../auth/index.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 404 or 403 — resource missing or caller is forbidden from it. */
export function isApiNotFoundOrForbidden(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 403);
}

/** 401 after the client has already attempted its refresh retry. */
export function isApiAuthFailure(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** Network failures (no status) or server errors (5xx). */
export function isApiTransientFailure(err: unknown): boolean {
  return err instanceof ApiError && (err.status === undefined || err.status >= 500);
}

/**
 * Resolve the API base URL.
 *
 * Precedence (same pattern as telemetry): env var wins over the discovery
 * document. Empty/whitespace-only env values are ignored.
 */
export function resolveApiBaseUrl(
  discoveryApiBaseUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.API_BASE_URL?.trim();
  if (fromEnv) {
    return normaliseApiBaseUrl(fromEnv);
  }
  if (discoveryApiBaseUrl?.trim()) {
    return normaliseApiBaseUrl(discoveryApiBaseUrl.trim());
  }
  return undefined;
}

/**
 * Whether the discovery document enables the My Projects feature.
 * Requires an explicit `projects.enabled: true`.
 */
export function isProjectsFeatureEnabled(
  projects?: { enabled?: boolean } | null,
): boolean {
  return projects?.enabled === true;
}

/**
 * Whether Search & Install / headless must be limited to the caller's
 * project membership allowlists (`projects.exclusiveSource: true`).
 * Only meaningful when projects are enabled.
 */
export function isProjectsExclusiveSource(
  projects?: { enabled?: boolean; exclusiveSource?: boolean } | null,
): boolean {
  return isProjectsFeatureEnabled(projects) && projects?.exclusiveSource === true;
}

/**
 * Whether My Projects should appear in the main menu.
 * Requires auth, `projects.enabled`, a resolved API base URL,
 * and an established auth session (tokens may still be refreshed on use).
 */
export function canAccessMyProjects(input: {
  authRequired?: boolean;
  projects?: { enabled?: boolean } | null;
  apiBaseUrl?: string;
  authSession?: AuthSession | null;
}): boolean {
  return Boolean(
    input.authRequired &&
      isProjectsFeatureEnabled(input.projects) &&
      input.apiBaseUrl &&
      input.authSession,
  );
}

/**
 * Normalise an API base URL by stripping a trailing slash.
 */
export function normaliseApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

async function fetchJson<T>(
  url: string,
  path: string,
  bearerToken: string,
  options: RequestInit,
): Promise<{ response: Response; data?: T }> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        ...options.headers,
      },
    });
  } catch (err) {
    throw new ApiError(
      `Failed to reach API at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (response.status === 204) {
    return { response, data: undefined as T };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(
      `API error ${response.status} for ${path}${body ? `: ${body}` : ''}`,
      response.status,
      body,
    );
  }

  return { response, data: (await response.json()) as T };
}

/**
 * Auth for API calls: a discovery session (store-backed refresh) or a static
 * bearer (e.g. AGENTMAN_ACCESS_TOKEN in headless/CI).
 */
export type ApiAuth = AuthSession | { bearerToken: string };

function isAuthSession(auth: ApiAuth): auth is AuthSession {
  return 'discoveryBaseUrl' in auth && 'auth' in auth;
}

async function resolveApiBearer(
  auth: ApiAuth,
  requestUrl: string,
  forceRefresh = false,
): Promise<string> {
  if (!isAuthSession(auth)) {
    return auth.bearerToken;
  }
  const tokenOptions = {
    interactiveMode: auth.interactiveMode,
    requestUrl,
    ...(forceRefresh ? { forceRefresh: true as const } : {}),
  };
  return getValidBearerToken(auth.discoveryBaseUrl, auth.auth, tokenOptions);
}

/**
 * Perform an authenticated JSON request against the API base URL.
 * Resolves a fresh bearer token before the request; on HTTP 401 with a session,
 * force-refreshes once and retries. Static bearers are not refreshed.
 */
export async function apiRequest<T>(
  apiBaseUrl: string,
  path: string,
  auth: ApiAuth,
  options: RequestInit = {},
): Promise<T> {
  const base = normaliseApiBaseUrl(apiBaseUrl);
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${normalisedPath}`;

  const bearerToken = await resolveApiBearer(auth, url);

  try {
    const { data } = await fetchJson<T>(url, path, bearerToken, options);
    return data as T;
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || !isAuthSession(auth)) {
      throw err;
    }
  }

  const refreshed = await resolveApiBearer(auth, url, true);
  const { data } = await fetchJson<T>(url, path, refreshed, options);
  return data as T;
}
