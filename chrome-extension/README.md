# Agentman Chrome Extension

Chrome extension that provisions Atlassian Rovo agents in [Studio](https://studio.atlassian.com) by automating the web UI. Agent configurations come from your local `~/.agentman/` bundles, served by the agent-manager CLI over a local HTTP connection.

## Prerequisites

- Node.js 22+
- The `agentman` CLI installed and configured with at least one agent bundle

## Install in Chrome

### Option A - Via Agent Manager (recommended)

Run agent manager and select **Install Chrome Extension** from the main menu. The CLI copies the pre-built `.crx` to `~/.agentman/chrome-extension/` and registers it with Chrome via the External Extensions mechanism. Restart Chrome, approve the prompt, and you're done.

Full details at [docs/chrome-extension-install.md](../docs/chrome-extension-install.md).

### Option B - Load unpacked (development)

1. Build the extension (see [Build](#build) below)
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `agent-manager/chrome-extension/dist/` directory

The extension icon (a robot) should appear in your toolbar.

## Build

```bash
cd agent-manager/chrome-extension
npm install
npm run build
```

This produces a self-contained `dist/` directory with all extension files.

To also produce a signed `.crx` for distribution:

```bash
npm run build:crx
```

This runs the standard build then packs `dist/` into `dist/agentman.crx` using the private key. The key is read from `agentman.pem` in this directory (local dev) or from the `AGENTMAN_CRX_KEY` environment variable (CI - base64-encoded PEM).

| Command | Description |
|---|---|
| `npm run build` | Clean build into `dist/` |
| `npm run build:crx` | Build then pack into `dist/agentman.crx` |
| `npm run typecheck` | Type-check sources with tsc (no emit) |
| `npm run clean` | Remove `dist/` |

## Usage

### 1. Start the server

Run agent manager in your terminal and select **Provision Rovo Agents -> Chrome Extension**. The CLI starts a local HTTP server and displays an auth token:

```
Server running on http://127.0.0.1:19876
Auth token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 2. Connect the extension

Click the extension icon in Chrome, paste the auth token, and click **Connect**. The extension fetches the list of available Rovo agents from the CLI.

### 3. Provision an agent

1. Open [Atlassian Studio](https://studio.atlassian.com) in a tab and navigate to your workspace's agents page
2. In the extension popup, click **Provision** next to the agent you want to create
3. The extension automates the Studio UI to fill in the agent's identity, scenarios, skills, and settings
4. A progress bar shows each step; when finished you'll see a success or error result

## Extension ID

The extension has a fixed ID derived from the public key embedded in `manifest.json`. The ID is:

```
jfplibfgoojmkffdcglchjdkpliiljbh
```

This ID is stable regardless of where the extension is installed - unpacked, loaded from `.crx`, or registered via External Extensions. The corresponding private key (`agentman.pem`) is gitignored and must be kept secure; the CI secret is `AGENTMAN_CRX_KEY` (base64-encoded PEM).

## Architecture

```
src/
├── background/service-worker.ts   # MV3 service worker (message relay)
├── content/content.ts             # Content script injected into Studio pages
├── lib/
│   ├── dom-helpers.ts             # Native DOM wrappers mirroring Playwright's API
│   ├── provisioner.ts             # Studio UI automation (port of RovoProvisioner)
│   └── types.ts                   # Shared TypeScript types
└── popup/
    ├── popup.html                 # Extension popup UI
    ├── popup.css                  # Dark theme styles
    └── popup.ts                   # Popup logic (connect, agent list, provisioning)
```

The content script and popup are bundled with esbuild into single IIFE files (Chrome content scripts cannot use ES module imports). The service worker uses native ESM supported by Manifest V3.

## Security

- The local server binds to `127.0.0.1` only — not accessible from the network
- Every request (except `/health`) requires a `Bearer` token generated per session
- Agent data is served from in-memory scanned bundle contents — no filesystem reads happen during HTTP requests
- Server API inputs are sanitised against directory traversal with a character allowlist and path boundary checks
