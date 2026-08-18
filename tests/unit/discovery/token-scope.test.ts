import { describe, expect, it } from 'vitest';
import { isOriginInDiscovery } from '../../../src/discovery/token-scope.js';
import type { DiscoveryDocument } from '../../../src/discovery/types.js';

describe('isOriginInDiscovery', () => {
  it('matches HTTP and artefact source origins', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bundle', type: 'http', url: 'https://content.example.com/catalogue' },
        { name: 'zip', type: 'artefact', url: 'https://cdn.example.com/skill.zip' },
      ],
    };

    expect(
      isOriginInDiscovery(discovery, 'https://content.example.com/agents/index.json'),
    ).toBe(true);
    expect(
      isOriginInDiscovery(discovery, 'https://cdn.example.com/skill.zip.sha256'),
    ).toBe(true);
  });

  it('does not match unlisted origins, different schemes, or different ports', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'bundle', type: 'http', url: 'https://content.example.com:8443' },
      ],
    };

    expect(isOriginInDiscovery(discovery, 'https://other.example.com/x.zip')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'http://content.example.com:8443/x.zip')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'https://content.example.com/x.zip')).toBe(false);
  });

  it('ignores git sources and malformed URLs', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'repo', type: 'git', url: 'https://github.com/org/repo' },
        { name: 'broken', type: 'http', url: 'not-a-url' },
      ],
    };

    expect(
      isOriginInDiscovery(
        discovery,
        'https://github.com/org/repo/releases/download/v1/skill.zip',
      ),
    ).toBe(false);
    expect(isOriginInDiscovery(discovery, 'not-a-url')).toBe(false);
  });

  it('never treats non-http(s) target URLs as token-eligible', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        { name: 'zip', type: 'artefact', url: 'https://cdn.example.com/skill.zip' },
      ],
    };

    // blob: inherits the inner URL's origin (https://cdn.example.com) and
    // would match a declared source if only the "null" sentinel were rejected.
    expect(isOriginInDiscovery(discovery, 'blob:https://cdn.example.com/uuid-123')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'data:application/zip;base64,AAAA')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'file:///etc/passwd')).toBe(false);
    // ftp: has a real (non-"null") origin — a protocol allowlist is what rejects it.
    expect(isOriginInDiscovery(discovery, 'ftp://cdn.example.com/skill.zip')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'foo:bar')).toBe(false);
  });

  it('never matches via a non-http(s) source URL, even against a same-scheme target', () => {
    const discovery: DiscoveryDocument = {
      version: '1',
      sources: [
        // Opaque origins serialize as the string "null"; two of them must
        // not compare equal and become token-eligible.
        { name: 'weird', type: 'http', url: 'data:text/plain,index' },
        { name: 'ftp', type: 'artefact', url: 'ftp://cdn.example.com/skill.zip' },
      ],
    };

    expect(isOriginInDiscovery(discovery, 'data:text/plain,payload')).toBe(false);
    expect(isOriginInDiscovery(discovery, 'ftp://cdn.example.com/other.zip')).toBe(false);
  });
});
