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

/**
 * Start a temporary HTTP server that waits for the OAuth callback,
 * extracts the authorization code, and shuts itself down.
 *
 * @param expectedState  The state value to validate against CSRF.
 * @param timeoutMs      How long to wait before giving up (default 5 minutes).
 * @returns The authorization code from the callback.
 */
export function waitForCallback(
  expectedState: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;

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
        settled = true;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(errorPage(description));
        shutdown();
        reject(new CallbackServerError(`Authorization failed: ${description}`));
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

      settled = true;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successPage());
      shutdown();
      resolve({ code, state });
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        shutdown();
        reject(new CallbackServerError('Timed out waiting for authorization callback'));
      }
    }, timeoutMs);

    function shutdown() {
      clearTimeout(timer);
      server.close();
    }

    server.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new CallbackServerError(
            `Failed to start callback server on port ${OAUTH_CALLBACK_PORT}: ${err.message}`,
          ),
        );
      }
    });

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
