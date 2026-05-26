import { describe, it, expect } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '../../../src/auth/pkce.js';

describe('generateCodeVerifier', () => {
  it('returns a string of the requested length', () => {
    const verifier = generateCodeVerifier(43);
    expect(verifier).toHaveLength(43);
  });

  it('defaults to 64 characters', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(64);
  });

  it('contains only base64url characters', () => {
    const verifier = generateCodeVerifier(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique values on successive calls', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('generateCodeChallenge', () => {
  it('returns a base64url-encoded SHA-256 hash', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = generateCodeChallenge(verifier);
    // S256 challenge should be a base64url string (no padding)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // SHA-256 digest is 32 bytes → 43 base64url chars (no padding)
    expect(challenge).toHaveLength(43);
  });

  it('produces a deterministic result for the same verifier', () => {
    const verifier = generateCodeVerifier();
    const a = generateCodeChallenge(verifier);
    const b = generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  it('produces different challenges for different verifiers', () => {
    const a = generateCodeChallenge('verifier-one');
    const b = generateCodeChallenge('verifier-two');
    expect(a).not.toBe(b);
  });
});

describe('generateState', () => {
  it('returns a base64url-encoded string', () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces unique values on successive calls', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});
