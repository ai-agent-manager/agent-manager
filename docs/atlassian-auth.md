# Atlassian Authentication

The agent-manager authenticates with Atlassian (Rovo Studio and Confluence) using the user's own browser session — not API tokens or stored credentials. This approach avoids credential management entirely and works with any login method the user's organisation supports (SSO, MFA, WebAuthn, passkeys, etc.).

## How it works

Authentication happens in two phases: an interactive login that captures a browser session, and a headless phase that reuses that session for subsequent API calls.

### Phase 1 — Interactive login

1. Playwright launches a **headed (visible) Chromium browser** pointing at the user-supplied Atlassian Studio URL.
2. The user logs in manually using whatever method their organisation requires.
3. The provisioner polls `window.location.href` until it contains `/agents` or `/studio`, or until the Studio UI is detected. Timeout: 5 minutes.
4. On success, Playwright's `context.storageState()` serialises the **entire browser session** — all cookies, `localStorage`, and `sessionStorage` — into a file at `~/.agentman/auth/atlassian-studio.json`.
5. The file and its parent directory are written with restrictive permissions (`chmod 0600` / `chmod 0700`) so only the current OS user can read them.

### Phase 2 — Reusing the session

When the provisioner needs to call Confluence's REST API (or navigate Rovo Studio), it:

1. Launches a **headless** Playwright browser restoring the saved `storageState` from disk, which replays the session cookies and storage into the new context.
2. Navigates to `<confluenceBaseUrl>/wiki` before making any API calls. This page load triggers Atlassian's SSO auto-login and sets any Confluence-subdomain cookies needed for API access.
3. Uses **`context.request`** (Playwright's built-in HTTP client) for all REST calls. Because `context.request` shares the browser context's cookie jar, session cookies are sent automatically — no `Authorization` header is constructed.

```
User (interactive)
  └─ headed Chromium → atlassian.net/login → logs in → Studio UI detected
       └─ storageState() → ~/.agentman/auth/atlassian-studio.json

Later (headless, automated)
  └─ headless Chromium + storageState loaded
       └─ navigate to /wiki  (triggers SSO cookie refresh)
       └─ context.request.get/post/put → Confluence REST API
            (session cookies attached automatically)
```

## Session lifetime

The saved auth state is valid for **24 hours** from the time it was written. This is enforced by comparing the file's `mtime` to the current time at the start of each provisioning run (`AUTH_TTL_MS = 24 * 60 * 60 * 1000` in `src/config/paths.ts`).

If the session has expired (or the file does not exist), the interactive login flow in Phase 1 is triggered automatically before continuing.

## What is and is not stored

| Item | Stored? | Where |
|---|---|---|
| Atlassian session cookies | Yes | `~/.agentman/auth/atlassian-studio.json` |
| Confluence URL | No | TUI session memory only |
| Confluence space key | No | TUI session memory only |
| API token / password | Never | — |

No API token, `ATLASSIAN_API_TOKEN` environment variable, `.env` file, or `Authorization: Bearer ...` header is used anywhere. Credentials are never written to disk.

## The `X-Atlassian-Token: no-check` header

`PUT` requests to the Confluence v1 REST API include this header:

```
X-Atlassian-Token: no-check
```

This is **not a credential**. It is Atlassian's required CSRF bypass header for REST API calls made from non-browser HTTP clients. Authentication still comes entirely from the session cookies.

## Confluence REST API calls

All requests go through `context.request` with session cookies attached automatically.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/wiki/api/v2/spaces?keys=<KEY>&limit=1` | Resolve space key to internal space ID |
| `GET` | `/wiki/api/v2/pages?spaceId=<id>&title=<name>&limit=1` | Search for an existing parent page by agent name |
| `GET` | `/wiki/rest/api/content/<id>/child/page?limit=50&expand=version` | List child pages of an existing parent (v1 API) |
| `GET` | `/wiki/rest/api/content/<id>?expand=version` | Fetch page version number for optimistic locking (v1 API, primary) |
| `GET` | `/wiki/api/v2/pages/<id>` | Fetch page version number (v2 API, fallback) |
| `POST` | `/wiki/api/v2/pages` | Create a new parent or child page |
| `PUT` | `/wiki/rest/api/content/<id>` | Update an existing page (v1 API) |

## Relevant source files

| File | Role |
|---|---|
| `src/provisioners/RovoProvisioner.ts` | All Confluence REST calls, auth state management, Playwright automation |
| `src/components/RovoMenu.tsx` | TUI state machine — collects Confluence URL and space key from the user |
| `src/config/paths.ts` | Auth file path (`~/.agentman/auth/atlassian-studio.json`) and `AUTH_TTL_MS` constant |
| `src/bundle/scanner.ts` | Discovers `assets/knowledge-base/*.md` files during bundle scan |
