# Discovery File Mechanism

## Overview

Agent Manager uses a **discovery document** served at a well-known path to locate skills and determine authentication requirements. Any team can publish a discovery document to their own domain.

**Well-known path:** `<base_url>/.well-known/agents/discovery.json`

When a user provides a base URL to agent-manager, it fetches the discovery document from this path. There is no fallback; the discovery document must exist.

## Discovery Document Format

```json
{
  "version": "1",
  "auth": {
    "required": true,
    "oidcDiscoveryUrl": "https://auth.example.com/.well-known/openid-configuration",
    "clientId": "agent-manager-abc123",
    "scopes": ["openid", "skills:read"]
  },
  "telemetry": {
    "url": "https://telemetry.example.com",
    "siteId": "acme-skills"
  },
  "skills": [
    {
      "name": "quality-review",
      "type": "git",
      "url": "https://github.com/acme/quality-review-plugin.git",
      "status": "official"
    },
    {
      "name": "deployment-tools",
      "type": "http",
      "url": "https://skills.example.com/bundles/deployment-tools",
      "status": "community"
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `"1"` | Yes | Schema version |
| `auth` | object | No | Authentication configuration (omit if no auth required) |
| `auth.required` | boolean | Yes (if auth present) | Whether authentication is needed to access skills |
| `auth.oidcDiscoveryUrl` | string (URI) | Yes (if auth.required=true) | URL to the standard OIDC discovery document |
| `auth.clientId` | string | Yes (if auth.required=true) | OAuth2 client ID for agent-manager to use |
| `auth.scopes` | string[] | No | OAuth2 scopes to request (defaults to `["openid"]`) |
| `telemetry` | object | No | Telemetry configuration (omit to leave unconfigured) |
| `telemetry.url` | string (URI) | Yes (if telemetry present) | Base URL of the telemetry endpoint |
| `telemetry.siteId` | string | Yes (if telemetry present) | Site identifier for the telemetry service |
| `skills` | array | Yes | List of available skills |
| `skills[].name` | string | Yes | Skill identifier |
| `skills[].type` | `"http"` \| `"git"` | Yes | How to fetch the skill |
| `skills[].url` | string (URI) | Yes | Location of the skill |
| `skills[].status` | `"official"` \| `"community"` | No | Trust level indicator |

### Skill Types

- **`http`** — URL points to a skill bundle (ZIP or similar) that agent-manager downloads directly. If auth is required, agent-manager passes the access token as a Bearer header.
- **`git`** — URL points to a git repository in the [Claude Code plugin marketplace format](https://code.claude.com/docs/en/plugin-marketplaces). Agent-manager clones the repo and scans for skills (`.claude-plugin/` directory, `skills/<name>/SKILL.md` files). Only skills are supported in this model.

## Authentication Flow

When `auth.required` is `true`:

1. Agent-manager fetches the OIDC discovery document from `auth.oidcDiscoveryUrl`.
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
8. Stores the `access_token` and `refresh_token` in `~/.agentman/auth/` (with a warning that this is filesystem-based storage).
9. Uses the access token for subsequent requests.

### Token Refresh

Before making authenticated requests, agent-manager checks token expiry. If expired, it uses the refresh token to obtain a new access token and updates the stored tokens.

### Token Storage

Tokens are stored at `~/.agentman/auth/<domain>.json` where `<domain>` is derived from the base URL. A warning is displayed to the user that tokens are stored on the filesystem (not in a system keychain).

