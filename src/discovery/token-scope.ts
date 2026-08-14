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
 * a token is attached only when the target URL's origin is one an `http` or
 * `artefact` source in the document lists.
 */

import type { DiscoveryDocument, SourceType } from './types.js';

/** Source types that actually receive the discovery access token. */
const TOKEN_ELIGIBLE_TYPES: ReadonlySet<SourceType> = new Set(['http', 'artefact']);

/**
 * Origin of a URL (`protocol` + `host`, so scheme and non-default port both
 * distinguish), or null when unparseable.
 */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether `targetUrl` sits on an origin listed in this discovery document
 * by an `http` or `artefact` source — the only types that receive this token.
 *
 * `git` hosts are ignored: a document that lists `https://github.com/org/repo`
 * must not attach the discovery credential when updating an artefact whose pin
 * happens to also be on github.com.
 *
 * Compares `origin` rather than `host`, so `http://` cannot inherit a match
 * from `https://` on the same host. A non-default port remains distinct.
 * Unparseable URLs — on either side — never match, so a malformed pin cannot
 * attract a token.
 */
export function isOriginInDiscovery(discovery: DiscoveryDocument, targetUrl: string): boolean {
  const target = originOf(targetUrl);
  if (!target) return false;

  return discovery.sources.some((source) => {
    if (!TOKEN_ELIGIBLE_TYPES.has(source.type)) return false;
    return originOf(source.url) === target;
  });
}
