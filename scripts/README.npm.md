# Agent Manager

A CLI with terminal and local browser interfaces for installing AI agent skills and provisioning Atlassian Rovo agents from a centrally-hosted bundle.

Agent Manager downloads a versioned bundle of skills and agent configs from a URL you provide, then lets you interactively install skills to your coding tools via symlinks.

## Quick Start

```bash
npx @ai-agent-manager/cli@latest https://your-bundle-server.com
```

This resolves the server's discovery document, authenticates if required, downloads
the selected sources into `~/.agentman/`, and opens an interactive menu. HTTP
startup inputs in the TUI and web UI require a discovery document; missing
discovery metadata is an error.

## Requirements

- Node.js 22.12 or higher
- Playwright (optional, only needed for Rovo agent provisioning)

## Usage

### Web UI (experimental)

```bash
npx -y @ai-agent-manager/cli@latest ui https://skills.example.com
```

The command opens a browser and prints a local URL. It supports browsing and
installing skills, managing installations/sources/settings, compatible version
selection, and sign-in/out. Use an HTTP discovery source or local bundle directory;
Git and artefact sources can be included in a discovery catalogue. Omit the source
to use saved sources.

- `--no-open` prints the URL without opening a browser.
- `--port 0` selects an available port. The default is 19877 with fallback when
  busy; an explicitly requested occupied port fails.
- `--update` forces reacquisition. `ui --help` and `ui --version` exit immediately.
- `ui` and the headless `--config` option cannot be combined.

Each launch creates a new bearer token in the printed URL. Keep it private; the
browser strips it from the address bar and keeps it in session storage for reloads.
The server listens only on local loopback. Sign-in uses an explicit authorization
link; upstream OAuth tokens stay in the keychain or private filesystem store.
Closing the tab leaves the server running. Use Quit or Ctrl-C to drain work and
stop; a second CLI Ctrl-C forces exit and may interrupt an operation. Published
packages include browser assets; users do not need Vite or Playwright for this UI.

### Run with npx

```bash
npx @ai-agent-manager/cli@latest <base-url>
```

The tool resolves `.well-known/agents/discovery.json` from the base URL to discover
skill sources and authentication requirements. Pass the root URL rather than an individual version's bundle ZIP.

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

- **My Projects** — Available when authenticated with projects enabled and a backend API configured. Browse permitted projects and their skills/agents.
- **Search & Install** — Browse skills and Rovo agents, choose a source, scope and tool, then install or provision.
- **Maintenance & Updates** — Bulk sync, manage skill versions, installed skills and cached bundles, or update the CLI.
- **Manage Sources** — Add, remove and activate saved sources, or install from a source URL.
- **Settings & Config** — Configure startup checks and telemetry; environment overrides take precedence.
- **Exit**

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
| GitHub Copilot | `<repo>/.github/skills/<skill-name>/` |
| Kiro | `<repo>/.kiro/skills/<skill-name>/` |
| Devin Desktop (formerly Windsurf) | `<repo>/.windsurf/skills/<skill-name>/` |

Symlinks point into the shared cache: named HTTP sources use
`~/.agentman/bundles/sources/<source-name>/<version>/<skill>`, while flat bundles
use `~/.agentman/bundles/<version>/<skill>`. On Windows, failed symlink creation
falls back to copying.

A `.agentman.json` file is created at the repo root to track installed skills and source pins. It is machine-specific runtime state: keep it gitignored and do not commit it. Share a headless install config for reproducible team setup instead.

## Bundle Format

HTTP startup inputs require `<base-url>/.well-known/agents/discovery.json`. The
document declares source content roots; an HTTP bundle source serves its index
at `<content-root>/index.json` and archives at `<content-root>/<version>/bundle.zip`.
Only headless mode supports a legacy index fallback when discovery returns 404.
Each zip contains:

- **`manifest.json`** -- Bundle metadata with `version` (semver) and `published` (ISO date).
- **Skill directories** -- Each containing a `SKILL.md` file per the [agentskills.io specification](https://agentskills.io/specification). Optionally includes `scripts/`, `references/`, and `assets/` subdirectories.
- **Rovo agent directories** -- Each containing a `rovo-agent.yaml` file with the agent configuration.
- **`README.md` frontmatter** -- Each directory can have a `README.md` with YAML frontmatter (`name`, `description`, `tags[]`) used for display metadata in the TUI.

## How It Works

1. Resolve the discovery document and acquire its sources. Named HTTP sources are cached under `~/.agentman/bundles/sources/<source-name>/<version>/`; flat bundles use `~/.agentman/bundles/<version>/`.
2. `~/.agentman/current` points to the active flat bundle. Named-source caches keep independent identities.
3. Multiple versions coexist. The web UI and TUI can select compatible versions for an installed skill; the web UI's global catalogue selection requires a directory source.
4. Installing a skill links its cached directory into the coding tool's skills path, or copies when symlinks are unavailable.
5. Installation records and source pins live in `~/.agentman/config.json` (system-wide) or local `.agentman.json` (repository-scoped).
