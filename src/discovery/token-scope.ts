/**
 * Origin scoping for the discovery access token.
 *
 * A discovery document's access token is applied to every source it lists,
 * including sources on origins other than the discovery origin — that is the
 * established contract, since a publisher may host content anywhere.
 *
 * Update and re-install paths are different: they act on a *persisted* pin,
 * which records only the content coordinate (artefact or bundle URL), not the
 * discovery document that authenticated the original install. Without a check,
 * a skill installed while pointed at one deployment could be updated while
 * pointed at another, sending the second deployment's token to the first one's
 * origin — a credential the operator never authorised for that host.
 *
 * These helpers keep token forwarding within the currently-loaded document:
 * a token is attached only when the target URL's origin is one the document
 * itself lists.
 */

import type { DiscoveryDocument } from './types.js';

/** Host (including any non-default port) of a URL, or null when unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether `targetUrl` sits on an origin listed in this discovery document.
 *
 * Compares `host` rather than `hostname`, so a source on a non-default port is
 * not treated as the same origin as one on the default port. Unparseable URLs —
 * on either side — never match, so a malformed pin cannot attract a token.
 */
export function isOriginInDiscovery(discovery: DiscoveryDocument, targetUrl: string): boolean {
  const target = hostOf(targetUrl);
  if (!target) return false;

  return discovery.sources.some((source) => hostOf(source.url) === target);
}
