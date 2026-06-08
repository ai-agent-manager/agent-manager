/**
 * Fetch and parse a standard OpenID Connect discovery document.
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html
 */

/** Subset of the OIDC discovery document fields we actually need. */
export interface OidcConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

const REQUIRED_FIELDS: (keyof OidcConfiguration)[] = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
];

export class OidcDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'OidcDiscoveryError';
  }
}

/**
 * Fetch the OIDC discovery document from the given URL.
 * Typically this is `https://auth.example.com/.well-known/openid-configuration`.
 */
export async function fetchOidcConfiguration(
  discoveryUrl: string,
): Promise<OidcConfiguration> {
  let response: Response;
  try {
    response = await fetch(discoveryUrl, {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new OidcDiscoveryError(
      `Failed to fetch OIDC discovery document from ${discoveryUrl}`,
      discoveryUrl,
      err,
    );
  }

  if (!response.ok) {
    throw new OidcDiscoveryError(
      `OIDC discovery document returned HTTP ${response.status} from ${discoveryUrl}`,
      discoveryUrl,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new OidcDiscoveryError(
      `OIDC discovery document at ${discoveryUrl} is not valid JSON`,
      discoveryUrl,
      err,
    );
  }

  if (typeof body !== 'object' || body === null) {
    throw new OidcDiscoveryError(
      `OIDC discovery document at ${discoveryUrl} is not a JSON object`,
      discoveryUrl,
    );
  }

  const config = body as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof config[field] !== 'string' || config[field] === '') {
      throw new OidcDiscoveryError(
        `OIDC discovery document missing required field '${field}'`,
        discoveryUrl,
      );
    }
  }

  return config as unknown as OidcConfiguration;
}
