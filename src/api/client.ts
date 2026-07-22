/**
 * Thin authenticated HTTP client for the publisher REST API.
 *
 * The base URL is resolved from `API_BASE_URL` (env) or `discovery.api.baseUrl`
 * — never hardcoded in application code.
 */

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
 * Requires an explicit `api.features.projects: true`.
 */
export function isProjectsFeatureEnabled(
  features?: { projects?: boolean },
): boolean {
  return features?.projects === true;
}

/**
 * Whether My Projects should appear in the main menu.
 * Requires auth, an explicit projects feature flag, a resolved API base URL,
 * and a bearer token.
 */
export function canAccessMyProjects(input: {
  authRequired?: boolean;
  features?: { projects?: boolean };
  apiBaseUrl?: string;
  bearerToken?: string | null;
}): boolean {
  return Boolean(
    input.authRequired &&
      isProjectsFeatureEnabled(input.features) &&
      input.apiBaseUrl &&
      input.bearerToken,
  );
}

/**
 * Normalise an API base URL by stripping a trailing slash.
 */
export function normaliseApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

/**
 * Perform an authenticated JSON request against the API base URL.
 */
export async function apiRequest<T>(
  apiBaseUrl: string,
  path: string,
  bearerToken: string,
  options: RequestInit = {},
): Promise<T> {
  const base = normaliseApiBaseUrl(apiBaseUrl);
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${normalisedPath}`;

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

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(
      `API error ${response.status} for ${path}${body ? `: ${body}` : ''}`,
      response.status,
      body,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
