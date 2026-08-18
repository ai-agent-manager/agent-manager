import type { DiscoveryDocument, SourceType } from './types.js';

const TOKEN_ELIGIBLE_TYPES: ReadonlySet<SourceType> = new Set(['http', 'artefact']);

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Only http(s) origins may become token-eligible. Other schemes either
    // serialize their origin as the literal string "null" (data:, custom
    // schemes — which would compare equal to each other) or inherit an inner
    // URL's origin (blob:https://… yields https://…) and must never match a
    // declared source.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns whether a persisted content URL belongs to an origin that receives
 * the active discovery document's bearer token.
 *
 * Scoping is whole-origin (scheme + host + port) — the standard web
 * credential model. All paths on a multi-tenant origin (path-style S3,
 * raw.githubusercontent.com, shared reverse proxies) share one origin, so
 * publishers of protected sources should serve them from a dedicated origin.
 */
export function isOriginInDiscovery(
  discovery: DiscoveryDocument,
  targetUrl: string,
): boolean {
  const targetOrigin = originOf(targetUrl);
  if (!targetOrigin) return false;

  return discovery.sources.some((source) => {
    if (!TOKEN_ELIGIBLE_TYPES.has(source.type)) return false;
    // An http source declares either a legacy base url or an explicit index
    // url; both name the same origin, and a source that declares only the
    // latter must still be token-eligible.
    const declaredUrl = source.type === 'http' ? (source.indexUrl ?? source.url) : source.url;
    return declaredUrl !== undefined && originOf(declaredUrl) === targetOrigin;
  });
}
