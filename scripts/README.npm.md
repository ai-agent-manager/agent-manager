# Agent Manager

A terminal UI tool for installing AI agent skills and provisioning Atlassian Rovo agents from a centrally-hosted bundle.

Agent Manager downloads a versioned bundle of skills and agent configs from a URL you provide, then lets you interactively install skills to your coding tools via symlinks.

## Quick Start

```bash
npx @ai-agent-manager/cli@latest https://your-bundle-server.com
```

This fetches the version index from `https://your-bundle-server.com/agents/index.json`, downloads the latest versioned bundle (e.g. `agents/1.2.0/bundle.zip`), caches it locally at `~/.agentman/`, and opens an interactive menu.

## Requirements

- Node.js 22 or higher
- Playwright (optional, only needed for Rovo agent provisioning)

## Usage

### Run with npx

```bash
npx @ai-agent-manager/cli@latest <base-url>
```

The tool fetches `/agents/index.json` from the base URL to discover available versions, then downloads the latest versioned zip (e.g. `/agents/1.2.0/bundle.zip`). You only need to pass the root URL of the bundle server.

### Force re-download

Re-download the latest bundle even if a cached version exists:

```bash
npx @ai-agent-manager/cli@latest <base-url> --update
```

### Help

```bash
npx @ai-agent-manager/cli@latest --help
```

## Telemetry

Agent Manager captures a small amount of privacy-safe operational telemetry so the team can understand adoption and identify when common flows fail.

This telemetry is designed to avoid sensitive local information. It focuses on high-level usage and outcome signals such as command startup, bundle operations, skill changes, and provisioning success or failure.

Telemetry is disabled automatically in CI and other non-interactive runs.

### Disable telemetry

Set any of the following environment variables before running the CLI:

```bash
DISABLE_TELEMETRY=1
DO_NOT_TRACK=1
AGENTMAN_TELEMETRY_DISABLED=1
```

### Interactive Menu

Once launched, the TUI presents the following options:

- **Install Skills** -- Choose system-wide or repository-scoped installation, select a coding tool, then choose which skills to install or uninstall via symlink.
- **Rovo Agents** -- Provision Atlassian Rovo agents into an Atlassian instance. Requires Playwright to be installed.
- **Manage Bundle Versions** -- View cached bundle versions, switch the active bundle, or remove old cached bundles.
- **Update Agent Manager App** -- Update the Agent Manager CLI application itself via npm. This is separate from bundle, skill, and Rovo agent version management.
- **Exit** -- Quit the tool.

When a newer app version or bundle is detected on startup, Agent Manager shows a bordered update panel above the main menu. From that screen you can press `U` to open the app updater or `B` to download and switch to the latest bundle immediately, ready for skill installs or updates.

You can disable startup update checks by setting `"startupUpdateChecksDisabled": true` in `~/.agentman/config.json` or by setting `AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS=1` before launching the CLI.

## Supported Coding Tools

Skills are installed as symlinks into each tool's native skills directory:

| Tool | Install Path |
|------|-------------|
| Agents | `~/.agents/skills/<skill-name>/` |
| Claude Code | `~/.claude/skills/<skill-name>/` |
| Cursor | `~/.cursor/skills/<skill-name>/` |
| GitHub Copilot | `~/.copilot/skills/<skill-name>/` |
| Kiro | `~/.kiro/skills/<skill-name>/` |
| Devin Desktop (formerly Windsurf) | `~/.codeium/windsurf/skills/<skill-name>/` |

On Windows, if symlink creation fails (requires admin or developer mode), the tool falls back to copying the skill directory.

### Repository-Scoped Installation

Skills can also be installed into a specific git repository instead of system-wide. When you run Agent Manager from inside a git repo, the scope selector offers **System-wide** or **This repository**.

Repository-scoped installs use tool-specific paths within the repo:

| Tool | Repo Install Path |
|------|------------------|
| Agents | `<repo>/.agents/skills/<skill-name>/` |
| Claude Code | `<repo>/.claude/skills/<skill-name>/` |
| Cursor | `<repo>/.cursor/skills/<skill-name>/` |
| GitHub Copilot | `<repo>/.github/copilot/skills/<skill-name>/` |
| Kiro | `<repo>/.kiro/skills/<skill-name>/` |
| Devin Desktop (formerly Windsurf) | `<repo>/.windsurf/skills/<skill-name>/` |

Symlinks still point to `~/.agentman/bundles/<version>/<skill>` -- the bundle content is not copied into the repo.

A `.agentman.json` file is created at the repo root to track the pinned bundle version and installed skills. Commit this file so your team shares the same version.

## Bundle Format

The tool expects the bundle server to host an index at `<base-url>/agents/index.json` listing available versions, with versioned zip files at `<base-url>/agents/<version>/bundle.zip`. Each zip contains:

- **`manifest.json`** -- Bundle metadata with `version` (semver) and `published` (ISO date).
- **Skill directories** -- Each containing a `SKILL.md` file per the [agentskills.io specification](https://agentskills.io/specification). Optionally includes `scripts/`, `references/`, and `assets/` subdirectories.
- **Rovo agent directories** -- Each containing a `rovo-agent.yaml` file with the agent configuration.
- **`README.md` frontmatter** -- Each directory can have a `README.md` with YAML frontmatter (`name`, `description`, `tags[]`) used for display metadata in the TUI.

## How It Works

1. On first run, the bundle is downloaded and extracted to `~/.agentman/bundles/<version>/`.
2. A `~/.agentman/current` symlink points to the active bundle version.
3. Multiple bundle versions can coexist. Use "Manage Versions" to switch between them.
4. When you install a skill, the tool symlinks the entire skill directory from the cached bundle into the target tool's skills path.
5. Installation records are tracked in `~/.agentman/config.json` (system-wide) or `.agentman.json` at the repo root (repository-scoped).
