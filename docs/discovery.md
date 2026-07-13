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
  "sources": [
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
    },
    {
      "name": "code-reviewer",
      "type": "artefact",
      "url": "https://cdn.example.com/skills/code-reviewer-1.0.0.zip",
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
| `sources` | array | Yes | List of available sources |
| `sources[].name` | string | Yes | Source identifier |
| `sources[].type` | `"http"` \| `"git"` \| `"artefact"` | Yes | How to fetch the source |
| `sources[].url` | string (URI) | Yes | Location of the source |
| `sources[].status` | `"official"` \| `"community"` | No | Informational label set by the discovery document publisher — agentman does not enforce or act on this value |

### Source Types

- **`http`** — URL points to a skill bundle (ZIP or similar) that agent-manager downloads directly. If auth is required, agent-manager passes the access token as a Bearer header. Supports both skills and rovo agents.
- **`git`** — URL points to a git repository in the [Claude Code plugin marketplace format](https://code.claude.com/docs/en/plugin-marketplaces). Agent-manager clones the repo and scans for skills (`.claude-plugin/` directory, `skills/<name>/SKILL.md` files). Only skills are supported in this model.
- **`artefact`** — URL points directly to a `.zip` file containing one or more packaged skills. Artefact URLs must use `https://` (plain `http://` is only allowed for `localhost` during development). Agent-manager downloads the zip, checks integrity against a `.sha256` sidecar if one exists (the install proceeds with a warning if no sidecar is found — publish a sidecar or set `artefact-sha256` for stronger guarantees), then extracts and scans for skills. Artefact sources are **untrusted third-party packages** — review the source before adding it to your discovery document. Artefact sources produce skills only (no rovo agents).

---

## Artefact Source — Packaging and Publishing

### What is an artefact?

An artefact is a **versioned `.zip` file** containing one or more skills. Unlike a bundle (which uses an index/manifest and supports rovo agents), an artefact is a self-contained package — simpler to create, version, and distribute.

### Directory layout inside the zip

agentman scans for skills in three layout patterns (checked in this order):

```
# Layout 1: SKILL.md at the zip root (single skill, name derived from zip filename)
artefact.zip/
  SKILL.md

# Layout 2: skill directories at the root (each dir with SKILL.md = one skill)
artefact.zip/
  my-skill/
    SKILL.md
  another-skill/
    SKILL.md

# Layout 3: single wrapper directory containing skill directories
artefact.zip/
  my-wrapper/
    my-skill/
      SKILL.md
    another-skill/
      SKILL.md
```

**Resolution order matters:** Layout 1 is checked first — if a `SKILL.md` exists at the root, that single skill is used and subdirectories are ignored (a warning is logged if skill directories are also present). Layout 3 only kicks in when there's exactly one top-level directory and no skills were found at root level.

> **Note:** In Layout 1, the skill's identifier is derived from the zip filename (e.g. `my-skill-1.0.0.zip` → `my-skill`), not from the `name:` field in `SKILL.md`. The `name:` field is used as display metadata only. Use Layouts 2 or 3 if you need to control the skill identifier directly.

Each skill **must** have a `SKILL.md` file. The frontmatter is optional but recommended:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
---

# My Skill

Instructions for the AI go here...
```

### Creating an artefact zip

```bash
# Single skill
mkdir -p my-skill && cp SKILL.md my-skill/
zip -r my-skill-1.0.0.zip my-skill/

# Multiple skills
mkdir -p skills/skill-a skills/skill-b
cp skill-a/SKILL.md skills/skill-a/
cp skill-b/SKILL.md skills/skill-b/
zip -r my-skills-2.0.0.zip skills/
```

### Publishing

1. **Upload the zip** to any HTTPS-accessible URL (CDN, GitHub Releases, S3, etc.)
2. **Create a `.sha256` sidecar** next to the zip:
   ```bash
   shasum -a 256 my-skill-1.0.0.zip | awk '{print $1}' > my-skill-1.0.0.zip.sha256
   ```
3. **Add to your discovery document:**
   ```json
   {
     "name": "my-skill-artefact",
     "type": "artefact",
     "url": "https://cdn.example.com/skills/my-skill-1.0.0.zip",
     "status": "official"
   }
   ```

### Version resolution

The artefact version is resolved in this priority order:
1. Version extracted from the URL/filename pattern (e.g. `my-skill-1.2.0.zip` → `1.2.0`, or a semver path segment like `.../1.2.0/skill.zip`)
2. Embedded `manifest.json` in the zip root (if present, with a `version` field)
3. Content hash as a fallback (`sha-<first 12 hex chars>`)

### Integrity verification

- agentman fetches `<artefact-url>.sha256` automatically (e.g. `my-skill-1.0.0.zip.sha256`)
- If the sidecar exists, the downloaded zip is verified against it
- If verification fails, the install is rejected (zip is deleted)
- If no sidecar exists, the install proceeds with a warning
- An explicit `sha256` field on the source (or `artefact-sha256` in headless config) takes precedence over the sidecar — use this for out-of-band integrity pinning:
  ```yaml
  artefact-sha256: 5927d6052d97440998d2b0de8d19b6142d35ddde9996d792aafde81c6efeb207
  ```

### Security requirements

- Artefact URLs **must** use `https://`
- Plain `http://` is only allowed for `localhost` / `127.0.0.1` / `::1` (local development)
- This prevents network attackers from swapping both the zip and its sha256 sidecar

### Example: full end-to-end

```bash
# 1. Create skill
mkdir -p my-skill
cat > my-skill/SKILL.md << 'EOF'
---
name: code-reviewer
description: Reviews pull requests for common issues
version: 1.0.0
---
# Code Reviewer
You review code changes and flag potential issues...
EOF

# 2. Package
zip -r code-reviewer-1.0.0.zip my-skill/

# 3. Create integrity sidecar
shasum -a 256 code-reviewer-1.0.0.zip | awk '{print $1}' > code-reviewer-1.0.0.zip.sha256

# 4. Upload both files to your CDN
# aws s3 cp code-reviewer-1.0.0.zip s3://my-bucket/skills/
# aws s3 cp code-reviewer-1.0.0.zip.sha256 s3://my-bucket/skills/

# 5. Add to discovery.json
# { "name": "code-reviewer", "type": "artefact", "url": "https://cdn.example.com/skills/code-reviewer-1.0.0.zip" }

# 6. Users install via:
# npx @ai-agent-manager/cli@latest https://your-domain.com
```

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

