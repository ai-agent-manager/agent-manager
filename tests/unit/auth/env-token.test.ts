import { describe, it, expect } from 'vitest';
import {
  AGENTMAN_ACCESS_TOKEN_ENV,
  AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV,
  getEnvAccessToken,
  getInteractiveTokenHosts,
  hostKeyFromHttpUrl,
  isHostAllowedForInteractiveEnvToken,
} from '../../../src/auth/env-token.js';

describe('getEnvAccessToken', () => {
  it('returns the token when AGENTMAN_ACCESS_TOKEN is set', () => {
    expect(
      getEnvAccessToken({ [AGENTMAN_ACCESS_TOKEN_ENV]: 'tok_abc' }),
    ).toBe('tok_abc');
  });

  it('trims surrounding whitespace', () => {
    expect(
      getEnvAccessToken({ [AGENTMAN_ACCESS_TOKEN_ENV]: '  tok_abc  ' }),
    ).toBe('tok_abc');
  });

  it('returns undefined when unset', () => {
    expect(getEnvAccessToken({})).toBeUndefined();
  });

  it('returns undefined for empty or whitespace-only values', () => {
    expect(getEnvAccessToken({ [AGENTMAN_ACCESS_TOKEN_ENV]: '' })).toBeUndefined();
    expect(getEnvAccessToken({ [AGENTMAN_ACCESS_TOKEN_ENV]: '   ' })).toBeUndefined();
  });
});

describe('getInteractiveTokenHosts', () => {
  it('parses comma-separated bare hostnames', () => {
    expect(
      getInteractiveTokenHosts({
        [AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV]: 'discovery.example.com, cdn.example.com',
      }),
    ).toEqual(['discovery.example.com', 'cdn.example.com']);
  });

  it('normalises https URLs to host keys', () => {
    expect(
      getInteractiveTokenHosts({
        [AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV]: 'https://Discovery.Example.com/path',
      }),
    ).toEqual(['discovery.example.com']);
  });

  it('returns undefined when unset or empty', () => {
    expect(getInteractiveTokenHosts({})).toBeUndefined();
    expect(
      getInteractiveTokenHosts({ [AGENTMAN_INTERACTIVE_TOKEN_HOSTS_ENV]: '  ' }),
    ).toBeUndefined();
  });
});

describe('hostKeyFromHttpUrl', () => {
  it('extracts host including non-default port', () => {
    expect(hostKeyFromHttpUrl('https://cdn.example.com:8443/skills.zip')).toBe(
      'cdn.example.com:8443',
    );
  });

  it('returns undefined for non-http URLs', () => {
    expect(hostKeyFromHttpUrl('file:///tmp/x')).toBeUndefined();
  });
});

describe('isHostAllowedForInteractiveEnvToken', () => {
  const allowed = ['discovery.example.com', 'cdn.example.com:8443'];

  it('returns true when the request host is listed', () => {
    expect(
      isHostAllowedForInteractiveEnvToken('https://discovery.example.com/index.json', allowed),
    ).toBe(true);
  });

  it('returns false when the request host is not listed', () => {
    expect(
      isHostAllowedForInteractiveEnvToken('https://evil.example.com/bundle.zip', allowed),
    ).toBe(false);
  });
});
