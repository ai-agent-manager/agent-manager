/**
 * Local HTTP server to receive the OAuth2 authorization code callback.
 *
 * Listens on a fixed port so the redirect_uri is predictable and can
 * be pre-registered with OAuth providers.
 */

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

/** Fixed port for the OAuth callback server. */
export const OAUTH_CALLBACK_PORT = 19875;
export const OAUTH_CALLBACK_PATH = '/callback';
export const REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;

export interface CallbackResult {
  code: string;
  state: string;
}

export class CallbackServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallbackServerError';
  }
}

export interface WaitForCallbackOptions {
  /** How long to wait before giving up (default 5 minutes). */
  timeoutMs?: number;
  /** Cancels the wait: closes the server and rejects with "Authentication cancelled". */
  signal?: AbortSignal;
}

/**
 * Start a temporary HTTP server that waits for the OAuth callback,
 * extracts the authorization code, and shuts itself down.
 *
 * @param expectedState  The state value to validate against CSRF.
 * @returns The authorization code from the callback.
 */
export function waitForCallback(
  expectedState: string,
  options: WaitForCallbackOptions = {},
): Promise<CallbackResult> {
  const { timeoutMs = 5 * 60 * 1000, signal } = options;

  return new Promise((resolve, reject) => {
    // A pre-aborted signal must never bind the port at all.
    if (signal?.aborted) {
      reject(new CallbackServerError('Authentication cancelled'));
      return;
    }

    let settled = false;

    // Every settlement path funnels through here so timeout, abort, the
    // request handler, and listen errors cannot race or double-settle, and
    // the abort listener never outlives the wait on a long-lived signal.
    function settle(outcome: () => void, opts: { awaitClose?: boolean } = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (opts.awaitClose) {
        // Settlement must guarantee the port is rebindable, and close() is
        // asynchronous — defer the outcome to its completion callback.
        // Destroy lingering (keep-alive) connections so close() cannot stall.
        server.close(() => outcome());
        server.closeAllConnections();
      } else {
        server.close();
        outcome();
      }
    }

    // On abort there is no in-flight response worth protecting, so waiting
    // for the close callback (and severing connections) is always safe.
    const onAbort = () =>
      settle(() => reject(new CallbackServerError('Authentication cancelled')), {
        awaitClose: true,
      });

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (settled) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost:${OAUTH_CALLBACK_PORT}`);

      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        const description = url.searchParams.get('error_description') ?? error;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(errorPage(description));
        settle(() => reject(new CallbackServerError(`Authorization failed: ${description}`)));
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(errorPage('Missing code or state parameter'));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(errorPage('State mismatch — possible CSRF attack'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successPage());
      settle(() => resolve({ code, state }));
    });

    const timer = setTimeout(() => {
      settle(() => reject(new CallbackServerError('Timed out waiting for authorization callback')));
    }, timeoutMs);

    server.on('error', (err) => {
      settle(() =>
        reject(
          new CallbackServerError(
            `Failed to start callback server on port ${OAUTH_CALLBACK_PORT}: ${err.message}`,
          ),
        ),
      );
    });

    signal?.addEventListener('abort', onAbort, { once: true });

    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1');
  });
}

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><title>Authorised</title></head>
<body style="font-family:system-ui;text-align:center;padding:4rem">
<h1>Authorised</h1>
<p>You can close this tab and return to agent-manager.</p>
</body></html>`;
}

function errorPage(message: string): string {
  const escaped = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html><head><title>Authorisation Failed</title></head>
<body style="font-family:system-ui;text-align:center;padding:4rem">
<h1>Authorisation Failed</h1>
<p>${escaped}</p>
<p>Return to agent-manager and try again.</p>
</body></html>`;
}
