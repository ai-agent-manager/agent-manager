import { describe, it, expect } from 'vitest';
import {
  AGENTMAN_ACCESS_TOKEN_ENV,
  getEnvAccessToken,
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
