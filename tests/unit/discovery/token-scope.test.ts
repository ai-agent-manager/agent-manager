import { describe, it, expect } from 'vitest';
import { isOriginInDiscovery } from '../../../src/discovery/token-scope.js';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

function makeDiscovery(urls: string[]): DiscoveryDocument {
  return {
    version: '1',
    sources: urls.map((url, i) => ({ name: `source-${i}`, type: 'http' as const, url })),
  };
}

describe('isOriginInDiscovery', () => {
  it('matches a target on a listed origin', () => {
    const discovery = makeDiscovery(['https://content.example.com']);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/agents/1.0.0/bundle.zip')).toBe(true);
  });

  it('matches when the source url carries a path and the target does not share it', () => {
    // The guard is about origin, not path: a pin under the same host is in scope
    // even when the source url points deeper into that host.
    const discovery = makeDiscovery(['https://content.example.com/agents']);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/elsewhere/x.zip')).toBe(true);
  });

  it('does not match a host absent from the document', () => {
    const discovery = makeDiscovery(['https://content.example.com']);
    expect(isOriginInDiscovery(discovery, 'https://other.example.com/agents/index.json')).toBe(false);
  });

  it('treats a different port as a different origin', () => {
    const discovery = makeDiscovery(['https://content.example.com:8443']);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com:9443/x.zip')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/x.zip')).toBe(false);
  });

  it('matches case-insensitively on host', () => {
    const discovery = makeDiscovery(['https://CONTENT.example.com']);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/x.zip')).toBe(true);
  });

  it('matches any one of several listed origins', () => {
    const discovery = makeDiscovery(['https://a.example.com', 'https://b.example.com']);
    expect(isOriginInDiscovery(discovery, 'https://b.example.com/x.zip')).toBe(true);
  });

  it('returns false for an unparseable target url', () => {
    const discovery = makeDiscovery(['https://content.example.com']);
    expect(isOriginInDiscovery(discovery, 'not-a-url')).toBe(false);
  });

  it('ignores unparseable source urls rather than matching them', () => {
    const discovery = makeDiscovery(['not-a-url']);
    expect(isOriginInDiscovery(discovery, 'not-a-url')).toBe(false);
  });

  it('returns false for a document with no sources', () => {
    expect(isOriginInDiscovery(makeDiscovery([]), 'https://content.example.com/x.zip')).toBe(false);
  });

  it('does not treat a git source host as token-eligible', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'community-repo', type: 'git', url: 'https://github.com/org/repo' },
        { name: 'official', type: 'http', url: 'https://content.example.com' },
      ],
    };
    expect(isOriginInDiscovery(discovery, 'https://github.com/org/other/releases/download/v1/skill.zip')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/agents/index.json')).toBe(true);
  });

  it('matches an artefact source origin', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [{ name: 'packaged', type: 'artefact', url: 'https://cdn.example.com/skills/tool.zip' }],
    };
    expect(isOriginInDiscovery(discovery, 'https://cdn.example.com/skills/other.zip')).toBe(true);
  });

  it('does not match http and https on the same host', () => {
    const discovery = makeDiscovery(['https://content.example.com']);
    expect(isOriginInDiscovery(discovery, 'http://content.example.com/x.zip')).toBe(false);
  });
});
