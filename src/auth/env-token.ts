/**
 * Environment-variable access token for non-interactive (and optional
 * interactive) auth — used when a browser OAuth flow is unavailable or
 * undesirable (e.g. CI).
 */

export const AGENTMAN_ACCESS_TOKEN_ENV = 'AGENTMAN_ACCESS_TOKEN';

/**
 * Read a Bearer token from `AGENTMAN_ACCESS_TOKEN`, if set.
 *
 * Empty or whitespace-only values are treated as unset.
 *
 * @param env  Process environment to read from (defaults to `process.env`).
 */
export function getEnvAccessToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[AGENTMAN_ACCESS_TOKEN_ENV]?.trim();
  return value ? value : undefined;
}
