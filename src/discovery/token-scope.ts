import type { DiscoveryDocument, SourceType } from './types.js';

const TOKEN_ELIGIBLE_TYPES: ReadonlySet<SourceType> = new Set(['http', 'artefact']);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns whether a persisted content URL belongs to an origin that receives
 * the active discovery document's bearer token.
 */
export function isOriginInDiscovery(
  discovery: DiscoveryDocument,
  targetUrl: string,
): boolean {
  const targetOrigin = originOf(targetUrl);
  if (!targetOrigin) return false;

  return discovery.sources.some(
    (source) =>
      TOKEN_ELIGIBLE_TYPES.has(source.type) &&
      originOf(source.url) === targetOrigin,
  );
}
