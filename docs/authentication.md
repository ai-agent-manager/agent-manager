# Authentication

Agent Manager authenticates against a publisher's identity provider when the [discovery document](discovery.md) declares `auth.required: true`. The same bearer token is used for protected skill downloads and for the optional [My Projects API](projects.md).

## Discovery document fields

Publishers configure auth in the discovery document's `auth` block. See the [field reference](discovery.md#fields) for the full schema; the auth-specific fields are:

| Field | Description |
|-------|-------------|
| `auth.required` | When `true`, protected sources and API calls need a bearer token |
| `auth.oidcDiscoveryUrl` | OIDC discovery URL — required for browser OAuth (may be omitted when all clients use `AGENTMAN_ACCESS_TOKEN`) |
| `auth.clientId` | OAuth2 client ID for the CLI |
| `auth.scopes` | OAuth2 scopes to request (defaults to `["openid"]`) |

JSON Schema: [`src/discovery/schema.json`](../src/discovery/schema.json).

## `AGENTMAN_ACCESS_TOKEN`

Set this environment variable to a bearer token to skip the browser OAuth flow. It works in **interactive** and **headless** mode:

```bash
AGENTMAN_ACCESS_TOKEN=eyJ... npx -y @ai-agent-manager/cli@latest https://your-bundle-server.com
AGENTMAN_ACCESS_TOKEN=eyJ... npx -y @ai-agent-manager/cli@latest https://your-bundle-server.com --config .github/ai-skills.yml
```

When set (non-empty after trimming), agent-manager uses the value directly and does not require `oidcDiscoveryUrl` / `clientId` in the discovery document. This is the usual approach for CI.

The token is sent as-is — no store lookup, no refresh.

## Browser OAuth (OIDC)

If `AGENTMAN_ACCESS_TOKEN` is unset:

1. Agent Manager fetches the OIDC discovery document from `auth.oidcDiscoveryUrl`.
2. From the OIDC document, it extracts `authorization_endpoint` and `token_endpoint`.
3. Generates PKCE `code_verifier` and `code_challenge`.
4. Constructs the authorization URL with:
   - `client_id` from the discovery document
   - `redirect_uri=http://localhost:19875/callback`
   - `response_type=code`
   - `scope` from `auth.scopes` (or `openid` by default)
   - `code_challenge` + `code_challenge_method=S256`
   - `state` (random, for CSRF protection)
5. Displays the URL in the TUI, allowing the user to:
   - Copy the link
   - Press a key to open it in the default browser
6. Starts an HTTP server on `localhost:19875` to receive the callback.
7. On receiving the callback with `?code=...&state=...`:
   - Validates state
   - Exchanges the code for tokens at the `token_endpoint`
8. Stores tokens in the OS keychain when available, otherwise under `~/.agentman/auth/` (filesystem, permissions `0600`, with a warning when the keychain is unavailable).
9. Uses a bearer token (ID token when the provider returns one, otherwise the access token) for subsequent authenticated requests.

In headless mode without a cached token and without `AGENTMAN_ACCESS_TOKEN`, agent-manager prints the authorise URL and exits — there is no browser login in CI.

## Token refresh

Agent Manager does **not** rely on a one-shot login at startup. Before each authenticated HTTP use — backend API calls (for example My Projects) and authenticated content downloads (`downloadBundle` / index fetches) — it:

1. Loads tokens for the discovery base URL from the store.
2. Returns the cached bearer if it is still valid.
3. If expired (or near expiry) and a refresh token is present, calls the OIDC `token_endpoint` with `grant_type=refresh_token`, saves the new tokens, and continues.
4. If refresh fails mid-session (non-interactive paths such as API/background), surfaces an auth error so the user can sign in again. Interactive startup can fall through to a full browser login instead.

For API requests that still receive HTTP 401 (for example tokens without a known `expires_in`), Agent Manager force-refreshes once and retries the request a single time.

In headless mode, `AGENTMAN_ACCESS_TOKEN` overrides the store entirely. When that env var is unset, headless uses the same cache/refresh path as the interactive client (browser login is not available in CI — use the env token or a pre-populated store).

## Token storage

Primary backend is the OS keychain (macOS Keychain, Windows Credential Manager, or Linux Secret Service via libsecret). When the keychain is unavailable (typical in CI), tokens fall back to `~/.agentman/auth/<domain>.json` where `<domain>` is derived from the discovery base URL hostname.

## Related

- [Discovery document format](discovery.md) — `auth`, `api`, and `projects` blocks
- [My Projects](projects.md) — authenticated API and project-scoped installs
- [Atlassian authentication](atlassian-auth.md) — separate browser-session auth for Rovo provisioning (not OIDC bearer tokens)
