# Getting started

Install Agent Manager and land skills in your coding tools in a few minutes.

## Requirements

- Node.js 22+
- Playwright _(optional — only needed for Rovo agent provisioning)_

## Quick start

```bash
npx @ai-agent-manager/cli@latest https://your-bundle-server.com
```

That fetches your team's discovery document, authenticates if required,
downloads the latest bundle, caches it at `~/.agentman/`, and opens an
interactive menu.

!!! note "Source types"
    `<source>` can be a bundle URL, a GitHub repo (`owner/repo` or a full URL),
    another git remote (`*.git` / `git@…`), or a local directory. HTTP bases
    fetch `.well-known/agents/discovery.json`; git remotes look for
    `.agents/discovery.json` first.

## Headless (CI)

Skip the menu with a config file:

```bash
npx @ai-agent-manager/cli@latest <source> --config .github/ai-skills.yml
```

**Config format:**

```yaml
tools: claude-code        # claude-code | windsurf | github-copilot | cursor | kiro
scope: repo              # repo (default) | system
skills:
  - my-skill-name
bundle-version: 1.2.0   # optional — bundle sources only
artefact-sha256: <hex>  # optional — artefact sources only
```

| Field | Required | Description |
|-------|----------|-------------|
| `tools` | Yes | AI coding tool(s) to install skills for |
| `scope` | No | `repo` installs into the current directory; `system` installs to the home directory |
| `skills` | Yes | Skill names to install (matched by directory name) |
| `bundle-version` | No | Pin a bundle version, or omit to track latest |
| `artefact-sha256` | No | Expected SHA-256 of an artefact zip |

!!! warning "Ambiguous skill names"
    If two sources ship the same skill id, use the fully-qualified name
    (for example `github.com/example-org/example-repo/my-skill`). Ambiguous
    bare names fail the run.

### GitHub Actions example

```yaml
- name: Install AI skills
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    npx @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo \
      --config .github/ai-skills.yml
```

## Install from GitHub

```bash
# Short form:
npx @ai-agent-manager/cli@latest org/agent-skills

# Pin a ref:
npx @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo/tree/v2.0 \
  --config .github/ai-skills.yml
```

For private repositories, set `GITHUB_TOKEN` with repo read access.

## Authentication

If your discovery source requires auth, Agent Manager runs an interactive
OAuth2/OIDC flow on first use. Tokens land in the OS keychain when available,
otherwise under `~/.agentman/auth/` (`0600`).

For CI against an auth-protected source:

```bash
AGENTMAN_ACCESS_TOKEN=... npx @ai-agent-manager/cli@latest https://your-bundle-server.com \
  --config .github/ai-skills.yml
```

See [Discovery](discovery.md) for the catalogue model and
[Authentication](authentication.md) for the full auth flow.

## Supported tools

| Tool | System-wide path | Repo-scoped path |
|------|------------------|------------------|
| Agents (generic) | `~/.agents/skills/<skill>/` | `<repo>/.agents/skills/<skill>/` |
| Claude Code | `~/.claude/skills/<skill>/` | `<repo>/.claude/skills/<skill>/` |
| Cursor | `~/.cursor/skills/<skill>/` | `<repo>/.cursor/skills/<skill>/` |
| GitHub Copilot | `~/.copilot/skills/<skill>/` | `<repo>/.github/skills/<skill>/` |
| Kiro | `~/.kiro/skills/<skill>/` | `<repo>/.kiro/skills/<skill>/` |
| Devin Desktop (Windsurf) | `~/.codeium/windsurf/skills/<skill>/` | `<repo>/.windsurf/skills/<skill>/` |

!!! tip "Windows symlinks"
    If symlink creation fails, Agent Manager falls back to copying the skill
    directory.

## Next steps

- [Discovery](discovery.md) — publish a catalogue
- [Authentication](authentication.md) — OIDC and CI bearer tokens
- [Artefact sources](artefact-sources.md) — third-party zip packaging
- [Bundle format](bundle-format.md) — zip layout and integrity sidecars
- [Telemetry](telemetry.md) — opt-out and overrides
