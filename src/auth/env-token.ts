/**
 * Environment-variable access token for non-interactive (and optional
 * interactive) auth — used when a browser OAuth flow is unavailable or
 * undesirable (e.g. CI).
 */

export const AGENTMAN_ACCESS_TOKEN_ENV = 'AGENTMAN_ACCESS_TOKEN';

/** Comma-separated host allowlist for using {@link AGENTMAN_ACCESS_TOKEN} in interactive mode. */
export const AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV = 'AGENTMAN_INTERACTIVE_TOKEN_HOSTS';

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

/**
 * Parse `AGENTMAN_INTERACTIVE_TOKEN_HOSTS` into normalised `host` keys
 * (lowercase hostname, optional `:port`).
 *
 * Entries may be bare hostnames (`example.com`), `host:port`, or full
 * `http(s)://` URLs (only the host portion is used).
 */
export function getInteractiveTokenHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const raw = env[AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV]?.trim();
  if (!raw) return undefined;

  const hosts = raw
    .split(',')
    .map(normalizeHostEntry)
    .filter((host): host is string => host !== null);

  return hosts.length > 0 ? hosts : undefined;
}

function normalizeHostEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  if (trimmed.includes('://')) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.host.toLowerCase();
    } catch {
      return null;
    }
  }

  if (trimmed.includes('/')) return null;
  return trimmed.toLowerCase();
}

/** Extract the `host` key from an HTTP(S) URL, or undefined when not applicable. */
export function hostKeyFromHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Whether `url`'s host is listed in `allowedHosts`. */
export function isHostAllowedForInteractiveEnvToken(
  url: string,
  allowedHosts: string[],
): boolean {
  const host = hostKeyFromHttpUrl(url);
  if (!host) return false;
  return allowedHosts.includes(host);
}
