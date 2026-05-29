# Agent Manager

A terminal UI tool for installing AI agent skills and provisioning Atlassian Rovo agents from a centrally-hosted bundle.

Agent Manager downloads a versioned bundle of skills and agent configs from a URL you provide, then lets you interactively install skills to your coding tools via symlinks — or non-interactively via a config file for use in CI pipelines.

## Quick Start

```bash
npx -y @ai-agent-manager/cli@latest https://your-bundle-server.com
```

This fetches the version index from `https://your-bundle-server.com/agents/index.json`, downloads the latest versioned bundle (e.g. `agents/1.2.0/bundle.zip`), caches it locally at `~/.agentman/`, and opens an interactive menu.

## Requirements

- Node.js 22 or higher
- Playwright (optional, only needed for Rovo agent provisioning)

## Usage

### Run with npx

```bash
npx -y @ai-agent-manager/cli@latest <base-url>
```

The tool fetches `/agents/index.json` from the base URL to discover available versions, then downloads the latest versioned zip (e.g. `/agents/1.2.0/bundle.zip`). You only need to pass the root URL of the bundle server.

### Force re-download

Re-download the latest bundle even if a cached version exists:

```bash
npx -y @ai-agent-manager/cli@latest <base-url> --update
```

### Headless install (non-interactive)

Install skills without the interactive menu by providing a config file. This is designed for CI pipelines and automated workflows such as GitHub Actions.

```bash
npx -y @ai-agent-manager/cli@latest <base-url> --config <path-to-config>
```

The config file can be named anything and placed anywhere. The recommended convention for GitHub-based projects is `.github/ai-skills.yml`.

**Config file format:**

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
| `tools` | Yes | One or more AI coding tools to install skills for. Accepts a list. |
| `scope` | No | `repo` installs into the current directory (default), `system` installs to the home directory |
| `bundle-version` | No | Specific bundle version to install from. Omit to always use the latest published version. |
| `skills` | Yes | List of skill names to install from the bundle |

**Example — GitHub Actions:**

```yaml
- name: Install skills
  run: |
    npx -y @ai-agent-manager/cli@latest https://bundles.example.com \
      --config .github/ai-skills.yml
```

When `--config` is provided, the tool installs the listed skills and exits immediately — no menu, no prompts. If a skill name is not found in the bundle, a warning is logged and installation continues with the remaining valid skills. If no valid skills are found, the tool exits with a non-zero code.

### Help

```bash
npx -y @ai-agent-manager/cli@latest --help
```

### Interactive Menu

Once launched, the TUI presents the following options:

- **Install Skills** -- Choose system-wide or repository-scoped installation, select a coding tool, then choose which skills to install or uninstall via symlink.
- **Rovo Agents** -- Provision Atlassian Rovo agents. By default this runs Playwright-driven browser automation from the command line. Set `AGENTMAN_CHROME_EXTENSION=1` to also offer the Chrome Extension provisioning method (see [Feature Flags](#feature-flags)).
- **Manage Bundle Versions** -- View cached bundle versions, switch the active bundle, or remove old cached bundles.
- **Update Agent Manager App** -- Update the Agent Manager CLI application itself via npm. This is separate from bundle, skill, and Rovo agent version management.
- **Exit** -- Quit the tool.

When a newer app version or bundle is detected on startup, Agent Manager shows a bordered update panel above the main menu. From that screen you can press `U` to open the app updater or `B` to download and switch to the latest bundle immediately, ready for skill installs or updates.

You can disable startup update checks by setting `"startupUpdateChecksDisabled": true` in `~/.agentman/config.json` or by setting `AGENTMAN_DISABLE_STARTUP_UPDATE_CHECKS=1` before launching the CLI.

## Telemetry

Agent Manager emits a small set of privacy-safe usage events so the team can understand adoption and operational health.

Tracked events include:

- CLI start
- Bundle download start, success, and failure
- Bundle extract, import, manifest load, and scan failures
- Update checks
- Repository scope and pinned bundle failures
- Bundle version switches
- Bundle version browse and switch failures
- Tool selection
- Skill install, uninstall, and installed-skill loading failures
- Rovo auth, knowledge-base checks, and provisioning start, success, and failure

Telemetry is designed to stay anonymous and low risk:

- No prompts, skill content, repo names, file paths, or local URLs are sent
- No personal identifiers are generated or persisted across runs
- Only coarse event metadata is sent, such as tool ID, scope, selected skill IDs, success and failure counts, bundle version, bundle endpoint URL, mode, and non-PII error category
- Delivery is non-blocking and failures are ignored

Telemetry is automatically disabled in CI and other non-interactive runs.

### Disable telemetry

Set any of the following environment variables before running the CLI:

```bash
DISABLE_TELEMETRY=1
DO_NOT_TRACK=1
AGENTMAN_TELEMETRY_DISABLED=1
```

### Override the endpoint

By default, Agent Manager posts to the configured Matomo-compatible telemetry endpoint with site ID `13`.

You can override this for testing or redirection:

```bash
AGENTMAN_TELEMETRY_URL=https://telemetry.example.com
AGENTMAN_TELEMETRY_SITE_ID=13
```

`AGENTMAN_TELEMETRY_URL` can be either the Matomo base URL or a full `matomo.php` endpoint.

## Feature Flags

Experimental and in-progress features can be enabled with environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTMAN_CHROME_EXTENSION` | off | Enable the Chrome Extension provisioning method under **Provision Rovo Agents**. When off (default), the method menu is skipped and Playwright command-line provisioning is used directly. |

**Example — enable the Chrome Extension option:**

```bash
AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest <base-url>
```

## Beta / prerelease builds

Pre-release builds are published to GitHub Packages when a pre-release version tag is pushed (e.g. `v1.2.3-beta.0`) as `@ai-agent-manager/cli` with the `beta` dist-tag. These require authentication to consume.

### Authenticate with GitHub Packages

You need a GitHub Personal Access Token (classic) with at least `read:packages` scope.

1. Create a token at <https://github.com/settings/tokens> — select **Generate new token (classic)** and tick `read:packages`.

2. Add the following to your `~/.npmrc` (create the file if it does not exist):

   ```
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```

   Replace `YOUR_GITHUB_TOKEN` with the token you just created.

3. Tell npm to resolve the `@ai-agent-manager` scope from GitHub Packages. Create or update a `.npmrc` in the directory you are running `npx` from (or add it to your home directory alongside the auth token):

   ```
  @ai-agent-manager:registry=https://npm.pkg.github.com/
   ```

### Run the beta build with npx

```bash
npx -y @ai-agent-manager/cli@beta https://your-bundle-server.com
```

Or pin to a specific version:

```bash
npx -y @ai-agent-manager/cli@0.1.0-beta https://your-bundle-server.com
```

## Supported Coding Tools

Skills are installed as symlinks into each tool's native skills directory:

| Tool | Install Path |
|------|-------------|
| Claude Code | `~/.claude/skills/<skill-name>/` |
| Windsurf | `~/.codeium/windsurf/skills/<skill-name>/` |
| GitHub Copilot | `~/.copilot/skills/<skill-name>/` |
| Cursor | `~/.agents/skills/<skill-name>/` |

Cursor does not have a global filesystem skills path. Skills are installed to `~/.agents/skills/` using the cross-client convention. You may need to configure Cursor to discover this location.

On Windows, if symlink creation fails (requires admin or developer mode), the tool falls back to copying the skill directory.

### Repository-Scoped Installation

Skills can also be installed into a specific git repository instead of system-wide. When you run Agent Manager from inside a git repo, the scope selector offers **System-wide** or **This repository**.

Repository-scoped installs use tool-specific paths within the repo:

| Tool           | Repo Install Path                             |
| -------------- | --------------------------------------------- |
| Claude Code    | `<repo>/.claude/skills/<skill-name>/`         |
| Windsurf       | `<repo>/.windsurf/skills/<skill-name>/`       |
| GitHub Copilot | `<repo>/.github/copilot/skills/<skill-name>/` |
| Cursor         | `<repo>/.cursor/skills/<skill-name>/`         |

Symlinks still point to `~/.agentman/bundles/<version>/<skill>` -- the bundle content is not copied into the repo.

A `.agentman.json` file is created at the repo root to track the pinned bundle version and installed skills. Commit this file so your team shares the same version.

## Bundle Format

The tool expects the bundle server to host an index at `<base-url>/agents/index.json` listing available versions, with versioned zip files at `<base-url>/agents/<version>/bundle.zip`. Each zip contains:

- **`manifest.json`** -- Bundle metadata with `version` (semver) and `published` (ISO date).
- **Skill directories** -- Each containing a `SKILL.md` file per the [agentskills.io specification](https://agentskills.io/specification). Optionally includes `scripts/`, `references/`, and `assets/` subdirectories.
- **Rovo agent directories** -- Each containing a `rovo-agent.yaml` file with the agent configuration for Playwright automation.
- **`README.md` frontmatter** -- Each directory can have a `README.md` with YAML frontmatter (`name`, `description`, `tags[]`) used for display metadata in the TUI.

## How It Works

1. On first run, the bundle is downloaded and extracted to `~/.agentman/bundles/<version>/`.
2. A `~/.agentman/current` symlink points to the active bundle version.
3. Multiple bundle versions can coexist. Use "Manage Versions" to switch between them.
4. When you install a skill, the tool symlinks the entire skill directory from the cached bundle into the target tool's skills path.
5. Installation records are tracked in `~/.agentman/config.json` (system-wide) or `.agentman.json` at the repo root (repository-scoped).

## Development

### Setup

```bash
npm install
```

### Run locally

```bash
npm run dev -- https://your-bundle-server.com
```

### Build

```bash
npm run build
```

Produces compiled output in `dist/`.

### Tests

```bash
npm test            # run once
npm run test:watch  # watch mode
```

### Type Check

```bash
npm run typecheck
```

## Publishing

Publishing is handled automatically by CI when a version tag is pushed. The version in `package.json` is set from the tag at publish time — no manual version bumps are needed. The publish jobs use the repository's `.nvmrc` configuration.

| Tag pattern | Registry | Package name | Dist-tag |
|-------------|----------|--------------|----------|
| `v*.*.*` (stable) | npmjs.org | `@ai-agent-manager/cli` | `latest` |
| `v*.*.*-*` (pre-release) | GitHub Packages | `@ai-agent-manager/cli` | `beta` |

To publish:

```bash
# Stable release
git tag v1.3.0
git push origin v1.3.0

# Beta release
git tag v1.3.0-beta.0
git push origin v1.3.0-beta.0
```

The production build is published to https://www.npmjs.com/package/@ai-agent-manager/cli

### Required secrets

The following secrets must be configured in the repository's **Settings → Secrets and variables → Actions**:

- **`NPM_TOKEN`** — an npm automation token with publish access to the `@ai-agent-manager` organisation. Generate one at <https://www.npmjs.com/settings/~/tokens> (select **Automation** type).

The `develop` → GitHub Packages job uses the built-in `GITHUB_TOKEN` — no extra secret is needed.

### Manual publish (npmjs.org)

If you need to publish manually outside of CI, make sure you are logged in with access to the `@ai-agent-manager` org:

```bash
npm login
```

Set the version and publish:

```bash
npm version 1.3.0 --no-git-tag-version
npm publish
```

`prepublishOnly` runs typecheck, tests, and a fresh build automatically before publishing.
