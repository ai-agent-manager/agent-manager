# Agent Manager

![Agent Manager](assets/logo-terminal.png)

Your team has AI skills. This tool makes sure everyone's coding agent actually uses them.

Agent Manager pulls a versioned bundle of skills and Rovo agent configs from a URL you control, then installs them into Claude Code, Windsurf, GitHub Copilot, or Cursor — interactively on a laptop, or silently in CI.

---

## Quick Start

```bash
npx -y @ai-agent-manager/cli@latest https://your-bundle-server.com
```

That's it. It fetches the version index, downloads the latest bundle, caches it at `~/.agentman/`, and opens an interactive menu.

---

## Why this exists

AI coding tools are only as useful as the skills they're given. Without a distribution mechanism, skills get shared in Slack, go stale, diverge per developer, and never make it into CI.

Agent Manager gives you a single source of truth for your team's agent skills — versioned, cacheable, and deployable anywhere Node runs.

---

## Requirements

- Node.js 22+
- Playwright _(optional — only needed for Rovo agent provisioning)_

---

## Usage

### Interactive (recommended for local use)

```bash
npx -y @ai-agent-manager/cli@latest <base-url>
```

Fetches `/agents/index.json` from your bundle server, downloads the latest versioned zip, and opens the TUI.

### Headless (recommended for CI)

Skip the menu entirely with a config file:

```bash
npx -y @ai-agent-manager/cli@latest <source> --config .github/ai-skills.yml
```

The `<source>` can be a **bundle URL**, a **GitHub repository URL**, a **published artefact** (a `.zip` URL), or a **local directory** — agentman detects the type automatically.

**Config format:**

```yaml
tools: claude-code        # one or more: claude-code | windsurf | github-copilot | cursor
scope: repo              # repo (default) | system
skills:
  - my-skill-name
bundle-version: 1.2.0   # optional — bundle sources only, omit to use latest
artefact-sha256: <hex>  # optional — artefact sources only, pins the expected zip hash
```

| Field | Required | Description |
|-------|----------|-------------|
| `tools` | Yes | AI coding tool(s) to install skills for |
| `scope` | No | `repo` installs into the current directory; `system` installs to the home directory |
| `skills` | Yes | Names of skills to install (matched by directory name) |
| `bundle-version` | No | Bundle sources only — pin to a specific version, or omit to track latest |
| `artefact-sha256` | No | Artefact sources only — expected SHA-256 of the zip; the install fails if the download doesn't match |

Unknown skill names log a warning and are skipped. If no valid skills are found, the tool exits non-zero.

#### Install from a GitHub repository

Point agentman at any GitHub repository that contains skills under a `skills/` directory:

```
my-skills-repo/
  skills/
    my-skill/
      SKILL.md
    another-skill/
      SKILL.md
```

```bash
npx -y @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo \
  --config .github/ai-skills.yml
```

For private repositories, set `GITHUB_TOKEN` to a personal access token with repo read access:

```bash
GITHUB_TOKEN=ghp_... npx -y @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo \
  --config .github/ai-skills.yml
```

To pin to a specific branch or tag, use the `/tree/<ref>` GitHub URL format:

```bash
npx -y @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo/tree/v2.0 \
  --config .github/ai-skills.yml
```

**GitHub Actions example:**

```yaml
- name: Install AI skills
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    npx -y @ai-agent-manager/cli@latest https://github.com/org/my-skills-repo \
      --config .github/ai-skills.yml
```

#### Install from a published artefact

Point agentman at a published, versioned skill `.zip` (an artefact). Unlike a bundle, an artefact is a single packaged skill (or small set of skills) addressed by a direct URL:

```bash
npx -y @ai-agent-manager/cli@latest https://cdn.example.com/skills/my-skill-1.2.0.zip \
  --config .github/ai-skills.yml
```

The version is resolved from the filename (`my-skill-1.2.0.zip`), the URL path, an embedded `manifest.json`, or — as a last resort — the content hash. The resolved version and source URL are pinned in the install record so the exact artefact can be reproduced and tracked later.

Integrity is verified against a `.sha256` sidecar published next to the zip (e.g. `my-skill-1.2.0.zip.sha256`). If no sidecar is found the download proceeds with a warning; if the hash doesn't match, the download is rejected. For an out-of-band pin that doesn't trust the artefact server, set `artefact-sha256` in `ai-skills.yml` — it takes precedence over the sidecar.

Artefact URLs must use `https://`. Plain `http://` is only accepted for localhost (local development against a mock server).

#### Install from a bundle server

```bash
npx -y @ai-agent-manager/cli@latest https://bundles.example.com \
  --config .github/ai-skills.yml
```

### Force re-download

Bypass the local cache and pull fresh content:

```bash
npx -y @ai-agent-manager/cli@latest <source> --update
```

### Help

```bash
npx -y @ai-agent-manager/cli@latest --help
```

---

## Interactive Menu

The TUI has four options:

- **Install Skills** -- Choose system-wide or repository-scoped installation, select a coding tool, then choose which skills to install or uninstall via symlink.
- **Rovo Agents** -- Provision Atlassian Rovo agents. By default this runs Playwright-driven browser automation from the command line. Set `AGENTMAN_CHROME_EXTENSION=1` to also offer the Chrome Extension options, including direct extension installation (see [Feature Flags](#feature-flags)).
- **Manage Bundle Versions** -- View cached bundle versions, switch the active bundle, or remove old cached bundles.
- **Update Agent Manager App** -- Update the Agent Manager CLI application itself via npm. This is separate from bundle, skill, and Rovo agent version management.

On startup, if a newer app version or bundle is available, a bordered update panel appears above the menu. Press `U` to update the app, or `B` to pull the latest bundle immediately.

To suppress startup update checks:

```bash
AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS=1 npx -y @ai-agent-manager/cli@latest <base-url>
```

Or set `"startupUpdateChecksDisabled": true` in `~/.agentman/config.json`.

---

## Supported Coding Tools

Skills are installed as symlinks into each tool's native skills directory:

| Tool | System-wide Path | Repo-scoped Path |
|------|-----------------|-----------------|
| Claude Code | `~/.claude/skills/<skill>/` | `<repo>/.claude/skills/<skill>/` |
| Windsurf | `~/.codeium/windsurf/skills/<skill>/` | `<repo>/.windsurf/skills/<skill>/` |
| GitHub Copilot | `~/.copilot/skills/<skill>/` | `<repo>/.github/copilot/skills/<skill>/` |
| Cursor | `~/.agents/skills/<skill>/` | `<repo>/.cursor/skills/<skill>/` |

> **Cursor note:** There is no official global filesystem skills path for Cursor. Skills install to `~/.agents/skills/` using the cross-client convention. You may need to configure Cursor to discover this location.

> **Windows note:** If symlink creation fails (requires admin rights or Developer Mode), the tool falls back to copying the skill directory instead.

### Repository-scoped installation

When you run Agent Manager from inside a git repo, the scope selector offers **System-wide** or **This repository**. Repo-scoped installs symlink from the shared bundle cache — the bundle itself isn't copied into the repo.

A `.agentman.json` file is written at the repo root tracking the pinned bundle version and installed skills. Commit this so everyone on the team stays in sync.

---

## How It Works

1. On first run, the bundle is downloaded and extracted to `~/.agentman/bundles/<version>/`.
2. `~/.agentman/current` symlinks to the active version.
3. Multiple bundle versions coexist on disk. Switch between them from the **Manage Versions** menu.
4. Installing a skill symlinks the entire skill directory from the cache into the target tool's skills path.
5. Installation state is tracked in `~/.agentman/config.json` (system-wide) or `.agentman.json` (repo-scoped).

---

## Bundle Format

The tool expects a version index at `<base-url>/agents/index.json` and versioned zips at `<base-url>/agents/<version>/bundle.zip`. See [docs/bundle-format.md](docs/bundle-format.md) for the full spec.

---

## Telemetry

Agent Manager can send a small set of anonymous usage events to help understand adoption and catch operational failures. Telemetry is opt-in, based on your bundle server. No prompts, skill content, repo names, file paths, or personal identifiers are ever sent. Telemetry is automatically disabled in CI.

See [docs/telemetry.md](docs/telemetry.md) for the full event list and instructions to disable or override the endpoint.

---

## Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTMAN_CHROME_EXTENSION` | off | Expose the Chrome Extension provisioning path under **Rovo Agents**. When off, Playwright CLI automation is used directly. |

```bash
AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest <base-url>
```

---

## Development

```bash
npm install          # install dependencies
npm run dev -- <url> # run locally against a bundle server
npm run build        # compile to dist/
npm test             # run tests once
npm run test:watch   # watch mode
npm run typecheck    # type check without emitting
```

### Mock HTTP skills server

Integration tests and local dev can run against a local mock of the agent CDN using [Imposter](https://docs.imposter.sh):

```bash
cd mocks
imposter up             # starts on http://localhost:8080
imposter down -a        # stop when done
```

Then run against the mock for a local integration test:

```bash
npm run dev -- http://localhost:8080
```

---

## Publishing

CI publishes automatically on version tags. See [docs/publishing.md](docs/publishing.md) for tag conventions, required secrets, manual publish steps, and beta/prerelease instructions.

---

## Contributing

Bug reports, fixes, and features are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, branch naming, and how to get a dev environment running.