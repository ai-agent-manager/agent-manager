# Discovery File Mechanism

## Overview

Agent Manager uses a **discovery document** served at a well-known path to locate skills and determine authentication requirements. Any team can publish a discovery document to their own domain. When auth is required, see [Authentication](authentication.md) (including env-token behaviour in interactive vs headless mode). For project-scoped installs, see [My Projects](projects.md).

**Well-known path:** `<base_url>/.well-known/agents/discovery.json`

When a user provides a base URL to agent-manager, it fetches the discovery document from this path. There is no fallback; the discovery document must exist.

## Discovery Document Format

```json
{
  "version": "1",
  "api": {
    "baseUrl": "https://api.example.com"
  },
  "projects": {
    "enabled": true,
    "exclusiveSource": false
  },
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
      "url": "https://skills.example.com/catalogues/deployment-tools",
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
| `api` | object | No | Authenticated backend API — see [My Projects](projects.md) |
| `api.baseUrl` | string (URI) | Yes (if `api` present) | Base URL of the authenticated REST API |
| `projects` | object | No | My Projects feature — see [My Projects](projects.md) |
| `projects.enabled` | boolean | Yes (if `projects` present) | When `true`, enable **My Projects** (requires auth and API base URL) |
| `projects.exclusiveSource` | boolean | No | When `true`, limit global installs to project membership allowlists |
| `auth` | object | No | Authentication configuration — see [Authentication](authentication.md) |
| `auth.required` | boolean | Yes (if auth present) | Whether authentication is needed to access skills |
| `auth.oidcDiscoveryUrl` | string (URI) | Yes for browser OAuth when `auth.required` | URL to the OIDC discovery document (may be omitted when all clients use `AGENTMAN_ACCESS_TOKEN`) |
| `auth.clientId` | string | Yes for browser OAuth when `auth.required` | OAuth2 client ID for agent-manager to use |
| `auth.scopes` | string[] | No | OAuth2 scopes to request (defaults to `["openid"]`) |
| `telemetry` | object | No | Telemetry configuration (omit to leave unconfigured) |
| `telemetry.url` | string (URI) | Yes (if telemetry present) | Base URL of the telemetry endpoint |
| `telemetry.siteId` | string | Yes (if telemetry present) | Site identifier for the telemetry service |
| `sources` | array | Yes | List of available sources |
| `sources[].name` | string | Yes | Stable logical source name, unique within the document. Identifies the source everywhere — install namespaces and pins — independently of where its content is hosted |
| `sources[].type` | `"http"` \| `"git"` \| `"artefact"` | Yes | How to fetch the source |
| `sources[].url` | string (URI) | Yes | Content root for `http`, repository URL for `git`, direct zip URL for `artefact` |
| `sources[].status` | `"official"` \| `"community"` | No | Informational label set by the discovery document publisher — agentman does not enforce or act on this value |

### Source Types

- **`http`** — `url` is the **content root**: the directory owning that source's `index.json` and its versioned subdirectories. For version `1.2.3`, agent-manager reads `<url>/index.json`, then `<url>/1.2.3/bundle.zip` and `<url>/1.2.3/bundle.zip.sha256`. It appends nothing else — there is no implicit `agents` path segment, so a source may publish at any path. If [authentication](authentication.md) is required, agent-manager passes the access token as a Bearer header. Supports both skills and rovo agents. When using `AGENTMAN_ACCESS_TOKEN` in the interactive TUI, include the content host in `AGENTMAN_INTERACTIVE_TOKEN_HOSTS` if it differs from the discovery base URL.
- **`git`** — URL points to a git repository in the [Claude Code plugin marketplace format](https://code.claude.com/docs/en/plugin-marketplaces). Agent-manager clones the repo and scans for skills (`.claude-plugin/` directory, `skills/<name>/SKILL.md` files). Only skills are supported in this model.
- **`artefact`** — URL points directly to a `.zip` file containing one or more packaged skills. Artefact URLs must use `https://` (plain `http://` is only allowed for `localhost` during development). Agent-manager downloads the zip, checks integrity against a `.sha256` sidecar if one exists (the install proceeds with a warning if no sidecar is found — publish a sidecar or set `artefact-sha256` for stronger guarantees), then extracts and scans for skills. Artefact sources are **untrusted third-party packages** — review the source before adding it to your discovery document. Artefact sources produce skills only (no rovo agents).

### HTTP bundle layout

For `"url": "https://skills.example.com/catalogues/team-a"`:

```text
https://skills.example.com/catalogues/team-a/index.json
https://skills.example.com/catalogues/team-a/1.2.3/bundle.zip
https://skills.example.com/catalogues/team-a/1.2.3/bundle.zip.sha256
```

### Source identity

Each installed skill's pin records the source `name`, and skills install under a
namespace derived from that name alone — not from the URL. Republishing a source
at a different host or path therefore leaves existing install paths and
coordinates intact.

Updates are a separate matter: the pin also records the content root the skill
was fetched from, and Update re-fetches that URL. So a source that moves needs
its installed skills re-resolved through the discovery document — name-based
re-resolution on update is not implemented yet.

Two sources on one origin stay distinct because their names differ, so names must
be unique within a document. agentman rejects a document whose names collide —
including names that differ only in case or punctuation, since those resolve to
one identity — rather than merging them.

Source names are only required to be unique *within* a document, so two documents
may each declare a source with the same name. agentman records the content root a
source was cached from and refuses to reuse that cache for a different root, so
one publisher's bundle is never served under another's pin.

### Migrating an existing deployment

Earlier releases treated an `http` source's `url` as a base and appended
`/agents/` themselves. Moving to a content root is a breaking change for
documents: append the publication prefix to each entry (`https://host` →
`https://host/agents`), and serve the content at both paths while clients still
in the field catch up — an older agentman asks for `<url>/agents/index.json` and
will 404 against a migrated document.

The schema `version` deliberately stays at `1`. An old-contract and a new-contract
document are therefore structurally identical — only the meaning of `url` differs —
and a client cannot tell which it is being served. That is accepted rather than
overlooked: the canonical content-sources design shows content-root URLs under
version 1, so versioning the contract here would put this client ahead of the
design it implements. The break is absorbed by the deployment step above and by
the pin migration below instead.

Installs already on disk are handled by the client. Every bundle pin that has a
URL records an addressing marker, so a pin written before this change is
recognised by that marker's absence; its first update
resolves against `<pinned url>/agents`, reproducing the URLs the original install
fetched, and the record is rewritten as a content root so later updates use it
unchanged.

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

For the authenticated API and **My Projects**, see [My Projects](projects.md).

