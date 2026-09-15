import { describe, it, expect } from 'vitest';
import { getGlobalDispatcher } from 'undici';
import { configureHttpDefaults, describeNetworkError } from '../../../src/lib/http.js';

function errWithCode(code: string): Error {
  const err = new Error(`boom (${code})`);
  (err as NodeJS.ErrnoException).code = code;
  return err;
}

describe('describeNetworkError', () => {
  it('maps undici connect timeout to an IPv6-aware message', () => {
    const message = describeNetworkError(errWithCode('UND_ERR_CONNECT_TIMEOUT'));
    expect(message).toMatch(/timed out/i);
    expect(message).toMatch(/IPv6/i);
  });

  it('maps undici headers timeout to a stalled-response message', () => {
    const message = describeNetworkError(errWithCode('UND_ERR_HEADERS_TIMEOUT'));
    expect(message).toMatch(/never sent a response/i);
  });

  it('maps undici body timeout to a stalled-download message', () => {
    const message = describeNetworkError(errWithCode('UND_ERR_BODY_TIMEOUT'));
    expect(message).toMatch(/stalled/i);
  });

  it('maps ENOTFOUND to a DNS message', () => {
    const message = describeNetworkError(errWithCode('ENOTFOUND'));
    expect(message).toMatch(/resolve the host name/i);
  });

  it('maps EAI_AGAIN to a DNS message', () => {
    const message = describeNetworkError(errWithCode('EAI_AGAIN'));
    expect(message).toMatch(/DNS/i);
  });

  it('maps ECONNREFUSED to a refused-connection message', () => {
    const message = describeNetworkError(errWithCode('ECONNREFUSED'));
    expect(message).toMatch(/refused/i);
  });

  it('maps CERT_* codes to a TLS message', () => {
    const message = describeNetworkError(errWithCode('CERT_HAS_EXPIRED'));
    expect(message).toMatch(/TLS certificate/i);
  });

  it('unwraps a nested cause chain to find the underlying code', () => {
    const inner = errWithCode('UND_ERR_CONNECT_TIMEOUT');
    const outer = new Error('fetch failed');
    (outer as Error & { cause?: unknown }).cause = inner;
    const message = describeNetworkError(outer);
    expect(message).toMatch(/timed out/i);
  });

  it('returns undefined for an unrecognised error code', () => {
    expect(describeNetworkError(errWithCode('SOME_UNKNOWN_CODE'))).toBeUndefined();
  });

  it('returns undefined for a plain error with no code', () => {
    expect(describeNetworkError(new Error('generic failure'))).toBeUndefined();
  });

  it('returns undefined for non-Error values', () => {
    expect(describeNetworkError('just a string')).toBeUndefined();
    expect(describeNetworkError(undefined)).toBeUndefined();
    expect(describeNetworkError(null)).toBeUndefined();
  });

  it('maps AbortError/TimeoutError by name', () => {
    const abort = new Error('The operation was aborted due to timeout');
    abort.name = 'TimeoutError';
    expect(describeNetworkError(abort)).toMatch(/timed out/i);
  });
});

describe('configureHttpDefaults', () => {
  it('installs a global dispatcher', () => {
    configureHttpDefaults();
    expect(getGlobalDispatcher()).toBeDefined();
  });

  it('is idempotent across repeated calls', () => {
    configureHttpDefaults();
    const first = getGlobalDispatcher();
    configureHttpDefaults();
    const second = getGlobalDispatcher();
    expect(second).toBe(first);
  });
});
