# Agentman Chrome Extension

Chrome extension that provisions Atlassian Rovo agents in [Studio](https://studio.atlassian.com) by automating the web UI. Agent configurations come from your local `~/.agentman/` bundles, served by the agent-manager CLI over a local HTTP connection.

## Prerequisites

- Node.js 18+
- The `agentman` CLI installed and configured with at least one agent bundle

## Build

```bash
cd agent-manager/chrome-extension
npm install
npm run build
```

This produces a self-contained `dist/` directory with all extension files.

Other scripts:

| Command | Description |
|---|---|
| `npm run build` | Clean build into `dist/` |
| `npm run typecheck` | Type-check sources with tsc (no emit) |
| `npm run clean` | Remove `dist/` |

## Install in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `agent-manager/chrome-extension/dist/` directory

The extension icon (a robot) should appear in your toolbar.

## Usage

### 1. Start the server

Run agent manager in your terminal and select **Connect to Chrome Extension**. The CLI starts a local HTTP server and displays an auth token:

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
