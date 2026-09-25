# Discovery File Mechanism

## Overview

> **Prefer `http` and `git` sources.** Use those types when declaring catalogue sources. The `artefact` type is a secondary option for third-party zip packages — see [Artefact packaging](artefacts.md).

Agent Manager uses a **discovery document** to locate skills and determine authentication requirements. Any team can publish one on their own HTTP origin or in a git repository. When auth is required, see [Authentication](authentication.md). For project-scoped installs, see [My Projects](projects.md).

**Discovery path (HTTP bases):** `<base_url>/.well-known/agents/discovery.json`

**Discovery path (git remotes):** `.agents/discovery.json` at the repository root

When a user provides an HTTP base URL, agent-manager fetches the discovery document from the HTTP path. In the interactive TUI there is no fallback — the document must exist. In headless mode (`--config`), a missing discovery document (HTTP 404) falls back to the legacy bare-bundle path so existing CI installs keep working.

When a user provides a **git remote** — GitHub `owner/repo` shorthand, a GitHub/GHES HTTPS URL, `*.git`, or `git@…` — agent-manager looks for the git path:

- **GitHub / GHES** — fetches the file via the Contents API (uses `GITHUB_TOKEN` when set, same as private skill installs). Works with branch, tag, and commit pins via `/tree/<ref>`.
- **Other git hosts** (for example Bitbucket) — shallow-clones the remote and reads the file from disk. A `git` binary is required for this path. `git@host:path` remotes still clone over SSH but use an `https://host/path` catalogue identity (SCP form is not a URL). `ssh://` remotes keep their `ssh://` identity, including any non-default port, so distinct SSH endpoints never share auth tokens.

If the file is present, that document is the catalogue. If it is absent, GitHub remotes fall back to installing skills directly from the repo; other git hosts require the discovery file.

`owner/repo` expands to `https://github.com/owner/repo`. If that string already names an existing local directory, the local directory wins. When a remote is saved to Source Management: GitHub shorthand becomes the expanded HTTPS URL (with `/tree/<ref>` kept when pinned); other git hosts keep their clone URL (including `.git`) so reload still treats them as remotes.

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
| `api.baseUrl` | string (URI) | Yes (if `api` present) | Base URL of the authenticated REST API (e.g. `https://api.example.com`). Never hardcoded — always taken from the discovery document (or `API_BASE_URL`). |
| `projects` | object | No | My Projects feature — see [My Projects](projects.md) |
| `projects.enabled` | boolean | Yes (if `projects` present) | When `true`, enable **My Projects** (also requires auth and a resolved API base URL) |
| `projects.exclusiveSource` | boolean | No | When `true` (default `false`), Search & Install and headless installs are limited to skills/agents permitted by at least one project the caller belongs to |
| `auth` | object | No | Authentication configuration — see [Authentication](authentication.md) |
| `auth.required` | boolean | Yes (if auth present) | Whether authentication is needed to access skills |
| `auth.oidcDiscoveryUrl` | string (URI) | Yes (if auth.required=true) | URL to the standard OIDC discovery document |
| `auth.clientId` | string | Yes (if auth.required=true) | OAuth2 client ID for agent-manager to use |
| `auth.scopes` | string[] | No | OAuth2 scopes to request (defaults to `["openid"]`) |
| `telemetry` | object | No | Telemetry configuration (omit to leave unconfigured) |
| `telemetry.url` | string (URI) | Yes (if telemetry present) | Base URL of the telemetry endpoint |
| `telemetry.siteId` | string | Yes (if telemetry present) | Site identifier for the telemetry service |
| `sources` | array | Yes | List of available sources |
| `sources[].name` | string | Yes | Stable logical source name, unique within the document. Identifies the source everywhere — install namespaces and pins — independently of where its content is hosted |
| `sources[].type` | `"http"` \| `"git"` \| `"artefact"` | Yes | How to fetch the source |
| `sources[].url` | string (URI) | Yes | Content root for `http`, repository URL for `git`, direct zip URL for `artefact` |
| `sources[].status` | `"official"` \| `"verified"` \| `"community"` | No | Trust label set by the discovery document publisher. Agentman uses it to order source choices but does not enforce trust decisions |

### Source Types

- **`http`** — `url` is the **content root**: the directory owning that source's `index.json` and its versioned subdirectories. For version `1.2.3`, agent-manager reads `<url>/index.json`, then `<url>/1.2.3/bundle.zip` and `<url>/1.2.3/bundle.zip.sha256`. It appends nothing else — there is no implicit `agents` path segment, so a source may publish at any path. If [authentication](authentication.md) is required, agent-manager passes the access token as a Bearer header. Supports both skills and rovo agents.
- **`git`** — URL points to a git repository in the [Claude Code plugin marketplace format](https://code.claude.com/docs/en/plugin-marketplaces). Agent-manager clones the repo and scans for skills (`.claude-plugin/` directory, `skills/<name>/SKILL.md` files). Only skills are supported in this model.
- **`artefact`** — URL points directly to a `.zip` file containing one or more packaged skills. Prefer `http` and `git` when you can; see [Artefact packaging](artefacts.md) for layout, integrity, and publishing. Artefact URLs must use `https://` (plain `http://` is only allowed for `localhost` during development). Artefact sources are **untrusted third-party packages** — review the source before adding it to your discovery document. Artefact sources produce skills only (no rovo agents).

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

For authentication (browser OAuth, token refresh, `AGENTMAN_ACCESS_TOKEN`), see [Authentication](authentication.md). For the authenticated API and **My Projects**, see [My Projects](projects.md). For packaging zip artefacts, see [Artefact packaging](artefacts.md).

