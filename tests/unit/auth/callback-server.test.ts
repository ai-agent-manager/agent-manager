import { describe, it, expect } from 'vitest';
import http from 'node:http';
import {
  waitForCallback,
  OAUTH_CALLBACK_PORT,
  OAUTH_CALLBACK_PATH,
  CallbackServerError,
} from '../../../src/auth/callback-server.js';

function sendCallback(params: Record<string, string>): Promise<number> {
  const qs = new URLSearchParams(params).toString();
  const url = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}?${qs}`;
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => resolve(res.statusCode ?? 0));
    req.on('error', reject);
  });
}

describe('waitForCallback', () => {
  // Each test starts its own server; give a short timeout to keep tests fast
  const SHORT_TIMEOUT = 3000;

  it('resolves with code and state on a valid callback', async () => {
    const promise = waitForCallback('expected-state', SHORT_TIMEOUT);
    // Give server a moment to start
    await new Promise((r) => setTimeout(r, 100));

    const status = await sendCallback({
      code: 'auth-code-123',
      state: 'expected-state',
    });
    expect(status).toBe(200);

    const result = await promise;
    expect(result).toEqual({ code: 'auth-code-123', state: 'expected-state' });
  });

  it('rejects when OAuth provider returns an error', async () => {
    const promise = waitForCallback('some-state', SHORT_TIMEOUT);
    // Attach a catch handler immediately to prevent unhandled rejection
    const caught = promise.catch((err) => err);
    await new Promise((r) => setTimeout(r, 100));

    await sendCallback({
      error: 'access_denied',
      error_description: 'User denied access',
    });

    const err = await caught;
    expect(err).toBeInstanceOf(CallbackServerError);
    expect(err.message).toContain('Authorization failed');
  });

  it('rejects on timeout', async () => {
    const promise = waitForCallback('state', 200);
    await expect(promise).rejects.toThrow('Timed out');
  });

  it('returns 400 when state does not match', async () => {
    const promise = waitForCallback('correct-state', SHORT_TIMEOUT);
    await new Promise((r) => setTimeout(r, 100));

    const status = await sendCallback({
      code: 'some-code',
      state: 'wrong-state',
    });
    expect(status).toBe(400);

    // Clean up by sending correct callback
    await sendCallback({ code: 'code', state: 'correct-state' });
    await promise;
  });

  it('returns 400 when code is missing', async () => {
    const promise = waitForCallback('my-state', SHORT_TIMEOUT);
    await new Promise((r) => setTimeout(r, 100));

    const status = await sendCallback({ state: 'my-state' });
    expect(status).toBe(400);

    // Clean up
    await sendCallback({ code: 'code', state: 'my-state' });
    await promise;
  });
});
