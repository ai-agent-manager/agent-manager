# Agentman Chrome Extension

Chrome extension that provisions Atlassian Rovo agents in [Studio](https://studio.atlassian.com) by automating the web UI. Agent configurations come from your local `~/.agentman/` bundles, served by the agent-manager CLI over a local HTTP connection.

> **📘 Complete Guide**: See [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) for end-to-end instructions: install extension → create agent → provision to Studio.

## Quick Start

### Prerequisites

- Node.js 22+
- The `agentman` CLI installed and configured with at least one agent bundle

### Development (Local Testing)

**Step 1: Build the extension**

```bash
cd chrome-extension
npm install
npm run build
```

**Step 2: Load into Chrome/Edge**

1. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Navigate to and select `chrome-extension/dist/` directory
5. Extension icon (🤖) appears in toolbar

**Step 3: Make changes and rebuild**

After code changes:

```bash
npm run build
```

Then click the reload icon (🔄) on the extension card in `chrome://extensions`.

### Production (After Merging)

**Option A: Install via Agent Manager CLI (Recommended)**

1. Run agent manager: `agentman`
2. Select **Install Chrome Extension** from menu
3. CLI copies pre-built `.crx` to `~/.agentman/chrome-extension/`
4. Restart Chrome/Edge
5. Approve extension installation prompt

**Option B: Build and pack manually**

```bash
cd chrome-extension
npm install
npm run build:crx
```

Produces `dist/agentman.crx` signed with private key. Distribute this file to users.

**Key management:**
- Local dev: Private key in `agentman.pem` (gitignored)
- CI: Private key in `AGENTMAN_CRX_KEY` env var (base64-encoded PEM)

## Available Commands

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm run build` | Clean build into `dist/` |
| `npm run build:crx` | Build + pack into `dist/agentman.crx` |
| `npm run typecheck` | Type-check with tsc (no emit) |
| `npm run clean` | Remove `dist/` |

## How to Use

### Step 1: Start the Agent Manager Server

```bash
agentman
```

Select **Provision Rovo Agents → Chrome Extension**

Server starts and displays:
```
Server running on http://127.0.0.1:19876
Auth token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### Step 2: Connect Extension to Server

1. Click extension icon (🤖) in Chrome/Edge toolbar
2. Paste auth token from terminal
3. Click **Connect**
4. Extension fetches available agents from CLI

### Step 3: Provision Agent

1. Open [Atlassian Studio](https://studio.atlassian.com)
2. Navigate to your workspace's agents page
3. In extension popup, click **Provision** next to desired agent
4. Extension automates Studio UI:
   - Fills agent identity (name, description)
   - Adds main instructions (with markdown formatting)
   - Creates subagents with names, triggers, and instructions
   - Enables subagents
   - Auto-clicks Activate
5. Progress bar shows each step
6. Success message appears when complete

**What Gets Provisioned:**
- ✅ Main agent instructions (markdown preserved)
- ✅ Subagent names
- ✅ Subagent triggers (invocationDescription)
- ✅ Subagent instructions (markdown preserved)
- ✅ Subagents auto-enabled (isActive: true)
- ✅ Skills, knowledge sources, web search settings

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
