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
npx -y @ai-agent-manager/cli@latest <base-url> --config .github/ai-skills.yml
```

**Config format:**

```yaml
tools: claude-code        # one or more: claude-code | windsurf | github-copilot | cursor
scope: repo              # repo (default) | system
bundle-version: 1.2.0   # optional — omit to always use latest
skills:
  - code-review-backend-v1
  - pr-description-generator-v1
```

| Field | Required | Description |
|-------|----------|-------------|
| `tools` | Yes | AI coding tool(s) to install skills for |
| `scope` | No | `repo` installs into the current directory; `system` installs to the home directory |
| `bundle-version` | No | Pin to a specific bundle version, or omit to track latest |
| `skills` | Yes | Skills to install from the bundle |

Unknown skill names log a warning and are skipped. If no valid skills are found, the tool exits non-zero.

**GitHub Actions example:**

```yaml
- name: Install AI skills
  run: |
    npx -y @ai-agent-manager/cli@latest https://bundles.example.com \
      --config .github/ai-skills.yml
```

### Force re-download

Bypass the local cache and pull the latest bundle:

```bash
npx -y @ai-agent-manager/cli@latest <base-url> --update
```

### Help

```bash
npx -y @ai-agent-manager/cli@latest --help
```

---

## Interactive Menu

The TUI has four options:

- **Install Skills** — Pick system-wide or repo-scoped, choose your coding tool, then select which skills to install or uninstall via symlink.
- **Rovo Agents** — Provision Atlassian Rovo agents using Playwright-driven browser automation. Set `AGENTMAN_CHROME_EXTENSION=1` to also expose the Chrome Extension provisioning path.
- **Manage Bundle Versions** — View cached versions, switch the active bundle, or clean up old ones.
- **Update Agent Manager** — Update the CLI itself via npm. Separate from bundle and skill versioning.

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

---

## Publishing

CI publishes automatically on version tags. See [docs/publishing.md](docs/publishing.md) for tag conventions, required secrets, manual publish steps, and beta/prerelease instructions.

---

## Contributing

Bug reports, fixes, and features are all welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, branch naming, and how to get a dev environment running.
