# Chrome Extension - Developer Guide

Technical documentation for engineers working on the Agentman Chrome Extension.

---

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Workflow](#development-workflow)
- [Architecture](#architecture)
- [Build System](#build-system)
- [Testing](#testing)
- [Distribution](#distribution)
- [Troubleshooting](#troubleshooting)
- [Technical Reference](#technical-reference)

---

## Overview

The Agentman Chrome Extension automates the provisioning of Atlassian Rovo agents in [Studio](https://studio.atlassian.com) by:

1. **UI Automation** - Fills form fields (name, description, instructions, subagents)
2. **Network Interception** - Patches GraphQL `createAgentMutation` payloads before sending
3. **ProseMirror Integration** - Serializes markdown from ProseMirror editors
4. **Auto-activation** - Automatically clicks the Activate button

Agent configurations are served from local `~/.agentman/` bundles via the agent-manager CLI over a localhost HTTP connection.

**Related Documentation:**
- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) - Complete end-to-end guide with provisioning workflows
- [README.md](./README.md) - Quick start and production usage
- [chrome-extension-install.md](../docs/chrome-extension-install.md) - Programmatic installation details

---

## Prerequisites

- **Node.js 22+** (check with `node --version`)
- **npm** (bundled with Node.js)
- **Chrome** or **Edge** browser
- **Agent Manager CLI** configured with at least one agent bundle

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd agent-manager
```

### 2. Enable the Chrome Extension Feature Flag

The Chrome Extension functionality is behind a feature flag. Enable it:

**macOS/Linux:**
```bash
export AGENTMAN_CHROME_EXTENSION=1
```

**Windows PowerShell:**
```powershell
$env:AGENTMAN_CHROME_EXTENSION="1"
```

**Windows Command Prompt (cmd.exe):**
```cmd
set AGENTMAN_CHROME_EXTENSION=1
```

**Why this flag exists:**
By default, Agent Manager uses Playwright-driven browser automation for Rovo agent provisioning. The Chrome Extension provides an alternative provisioning method that runs directly in the browser. Setting this flag exposes the Chrome Extension options in the Agent Manager CLI menu.

**Persistence:**
Add to your shell profile (`~/.bashrc`, `~/.zshrc`, or `~/.profile`):

```bash
echo 'export AGENTMAN_CHROME_EXTENSION=1' >> ~/.bashrc
source ~/.bashrc
```

### 3. Navigate to Chrome Extension Directory

```bash
cd chrome-extension
```

### 4. Install Dependencies

```bash
npm install
```

This installs:
- `esbuild` - Fast JavaScript bundler
- `typescript` - Type checking
- `@types/chrome` - Chrome extension API types
- `crx` - CRX file packager

### 5. Build the Extension

```bash
npm run build
```

**What happens:**
1. Removes existing `dist/` directory
2. Runs `esbuild.config.mjs` to bundle TypeScript files
3. Outputs to `chrome-extension/dist/`:
   - `background/service-worker.js` - MV3 background service worker
   - `content/content.js` - Content script (IIFE bundle)
   - `popup/popup.js` - Popup UI logic (IIFE bundle)
   - `page-world/inject.js` - Main-world script for DOM access
   - `popup/popup.html` & `popup/popup.css` - Popup UI
   - `manifest.json` - Extension manifest (copied)
   - `icons/` - Extension icons (copied)

### 6. Load Unpacked Extension in Browser

**Chrome:**

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Navigate to `chrome-extension/dist/` directory and select it
5. Extension icon (🤖) appears in browser toolbar

**Edge:**

1. Open `edge://extensions`
2. Enable **Developer mode** (toggle in left sidebar)
3. Click **Load unpacked**
4. Navigate to `chrome-extension/dist/` directory and select it
5. Extension icon (🤖) appears in browser toolbar

**Verify Installation:**
- Extension card shows "Agentman - Rovo Agent Provisioner"
- Version: `0.1.1` (check `manifest.json` for current version)
- ID: `jfplibfgoojmkffdcglchjdkpliiljbh` (fixed, derived from public key)

---

## Development Workflow

### Making Code Changes

1. **Edit source files** in `chrome-extension/src/`:
   - `popup/popup.ts` - Extension popup logic
   - `content/content.ts` - Content script for Studio pages
   - `page-world/inject.ts` - Main-world script (DOM access)
   - `lib/provisioner.ts` - UI automation logic
   - `lib/dom-helpers.ts` - Native DOM wrappers
   - `lib/types.ts` - TypeScript type definitions

2. **Rebuild:**
   ```bash
   npm run build
   ```

3. **Reload extension:**
   - Go to `chrome://extensions` (or `edge://extensions`)
   - Click the reload icon (🔄) on the extension card
   - **Do NOT** uninstall and reinstall - just reload

4. **Test changes:**
   - Click extension icon (🤖) to test popup
   - Open Atlassian Studio to test provisioning
   - Check browser console (`F12`) for logs

**Hot Reload (Optional):**
```bash
npm run watch
```
Automatically rebuilds on file changes. You still need to manually reload the extension in `chrome://extensions`.

### Type Checking

Run TypeScript type checker without emitting files:

```bash
npm run typecheck
```

Fix any type errors before committing.

### Cleaning Build Artifacts

Remove `dist/` directory:

```bash
npm run clean
```

---

## Architecture

### Directory Structure

```
chrome-extension/
├── src/
│   ├── background/
│   │   └── service-worker.ts      # MV3 service worker (message relay)
│   ├── content/
│   │   └── content.ts              # Content script (Studio page automation)
│   ├── page-world/
│   │   └── inject.ts               # Main-world script (GraphQL interception)
│   ├── lib/
│   │   ├── dom-helpers.ts          # Native DOM wrappers (Playwright-like API)
│   │   ├── provisioner.ts          # RovoProvisioner (UI automation logic)
│   │   └── types.ts                # TypeScript types (RovoAgentConfig, etc.)
│   └── popup/
│       ├── popup.html              # Extension popup UI
│       ├── popup.css               # Dark theme styles
│       └── popup.ts                # Popup logic (connect, agent list)
├── icons/                          # Extension icons (16x16, 48x48, 128x128)
├── dist/                           # Build output (gitignored)
├── manifest.json                   # Extension manifest (MV3)
├── esbuild.config.mjs              # esbuild bundler configuration
├── build-crx.mjs                   # CRX packager script
├── package.json                    # npm scripts and dependencies
├── tsconfig.json                   # TypeScript configuration
├── README.md                       # Quick start guide
├── HOW-IT-WORKS.md                 # Complete end-to-end guide
└── DEVELOPER.md                    # This file
```

### Component Interaction Flow

```
┌─────────────────┐
│   Popup (UI)    │ ← User clicks "Connect", pastes auth token
└────────┬────────┘
         │ (1) Fetch agents from CLI server
         ▼
┌─────────────────┐
│  CLI Server     │ ← Serves agent configs from ~/.agentman/
│  (localhost)    │    (http://127.0.0.1:19876)
└────────┬────────┘
         │ (2) Agent configs
         ▼
┌─────────────────┐
│   Popup (UI)    │ ← Shows agent list, user clicks "Provision"
└────────┬────────┘
         │ (3) Send provision command
         ▼
┌─────────────────┐
│ Content Script  │ ← Runs in Studio page context
│   (content.ts)  │    Fills UI fields (name, description, instructions)
└────────┬────────┘
         │ (4) Fill form fields
         ▼
┌─────────────────┐
│  Studio Page    │ ← User clicks "Activate" (or auto-clicked)
│  (DOM elements) │
└────────┬────────┘
         │ (5) Click Activate
         ▼
┌─────────────────┐
│ Page-World      │ ← Intercepts fetch() for GraphQL mutations
│   (inject.ts)   │    Patches createAgentMutation payload
└────────┬────────┘
         │ (6) Patched mutation
         ▼
┌─────────────────┐
│ Atlassian API   │ ← Receives mutation, creates agent
└─────────────────┘
```

### Key Technical Details

**Manifest V3:**
- Uses service worker instead of background page
- Content scripts cannot use ES modules (bundled as IIFE)
- Service worker supports native ESM

**Content Script vs Page-World Script:**
- **Content Script** (`content.ts`): Isolated JavaScript context, can access Chrome APIs but limited DOM access
- **Page-World Script** (`inject.ts`): Runs in main world, full DOM access, can intercept `fetch()`, no Chrome APIs

**ProseMirror Serialization:**
- Studio uses ProseMirror for rich text editing
- Extension serializes ProseMirror document to markdown
- Preserves formatting (headings, lists, bold, italic, code blocks)

**GraphQL Mutation Patching:**
- Intercepts `fetch()` calls to `/gateway/api/graphql/`
- Detects `createAgentMutation` operation
- Patches `input.name`, `input.description`, `input.instructions`
- Patches `scenarios[].name`, `scenarios[].invocationDescription`, `scenarios[].instructions`
- Auto-enables subagents (`scenarios[].isActive = true`)

---

## Build System

### esbuild Configuration

See `esbuild.config.mjs`:

```javascript
// Bundles TypeScript to JavaScript
// - popup.ts → IIFE bundle (no ES modules)
// - content.ts → IIFE bundle (no ES modules)
// - page-world/inject.ts → IIFE bundle (no ES modules)
// - service-worker.ts → ESM (Manifest V3 supports it)
```

**Why IIFE for content scripts?**
Chrome content scripts do not support ES module imports. esbuild bundles all dependencies into a single IIFE (Immediately Invoked Function Expression).

### npm Scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Clean build into `dist/` |
| `npm run build:crx` | Build + pack into signed `.crx` file |
| `npm run typecheck` | Type-check with TypeScript (no emit) |
| `npm run watch` | Watch mode (auto-rebuild on changes) |
| `npm run clean` | Remove `dist/` directory |

---

## Testing

### Manual Testing Checklist

**Prerequisites:**
1. Start Agent Manager CLI with feature flag:
   ```bash
   AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest https://bootstrap.example.com
   ```
2. Select **Provision Rovo Agents → Chrome Extension**
3. Note the auth token from terminal

**Test Cases:**

✅ **Connection Flow:**
1. Click extension icon (🤖)
2. Paste auth token
3. Click "Connect"
4. Verify agent list appears

✅ **Provisioning Flow:**
1. Open https://studio.atlassian.com
2. Navigate to agents page
3. Click extension icon (🤖)
4. Click "Provision" next to an agent
5. Verify progress bar appears
6. Verify agent created in Studio

✅ **Field Verification:**
1. Open created agent in Studio
2. Verify name matches YAML config
3. Verify description matches YAML config
4. Verify main instructions (markdown preserved)
5. Verify subagents created with correct names
6. Verify subagent triggers (invocationDescription) populated
7. Verify subagent instructions (markdown preserved)
8. Verify subagents enabled (isActive: true)

✅ **Error Handling:**
1. Try connecting with invalid token
2. Try provisioning when server is down
3. Verify error messages display correctly

### Debugging

**Browser Console:**
1. Open Studio page
2. Press `F12` to open DevTools
3. Go to Console tab
4. Look for `[ROVO PATCH]` logs

**Check Mutation Capture:**
```javascript
// In browser console on Studio page:
window.__rovoCapture
// Shows captured GraphQL mutations
```

**Verify Page-World Script Loaded:**
```javascript
// In browser console on Studio page:
window.__rovoPageWorldInstalled
// Should return 9 (version number)
```

**Extension Logs:**
1. Go to `chrome://extensions`
2. Click "Details" on extension card
3. Click "Inspect views: background page" (for service worker logs)
4. Or click "Inspect" on popup (for popup logs)

---

## Distribution

### Option 1: Load Unpacked (Development)

See [Quick Start](#quick-start) section above.

### Option 2: Build CRX File (Production)

**Build signed `.crx`:**

```bash
npm run build:crx
```

**Output:** `dist/agentman.crx`

**What happens:**
1. Runs `npm run build` (cleans and rebuilds)
2. Runs `build-crx.mjs`:
   - Looks for `agentman.pem` (private key) in `chrome-extension/`
   - Packs `dist/` into `dist/agentman.crx`
   - Signs with private key

**Private Key Management:**
- **Local dev:** Private key in `agentman.pem` (gitignored)
- **CI:** Private key in `AGENTMAN_CRX_KEY` env var (base64-encoded PEM)

**Generate new private key (if needed):**

The first time you run `npm run build:crx`, a new `agentman.pem` is automatically generated if it doesn't exist. **Keep this file secure and do NOT commit it to git.**

**Install `.crx` manually:**
1. Drag `dist/agentman.crx` to `chrome://extensions`
2. Approve installation prompt

### Option 3: Via Agent Manager CLI (Recommended)

**For end users:**

```bash
AGENTMAN_CHROME_EXTENSION=1 npx -y @ai-agent-manager/cli@latest <base-url>
```

Select: **Install Chrome Extension** from menu

CLI automatically:
1. Copies pre-built `.crx` to `~/.agentman/chrome-extension/`
2. Writes registration JSON to External Extensions directory (macOS/Linux)
3. Prints manual registry steps (Windows)

See [chrome-extension-install.md](../docs/chrome-extension-install.md) for details.

### Extension ID

The extension has a **fixed, stable ID**: `jfplibfgoojmkffdcglchjdkpliiljbh`

**Why is it fixed?**
The ID is derived from the public key embedded in `manifest.json` (`key` field). This ensures the same ID across:
- Unpacked (development)
- `.crx` file (production)
- External Extensions (CLI installation)

Chrome recognizes all installations as the same extension, preserving settings and data.

---

## Troubleshooting

### Problem: Instructions empty after provisioning

**Symptoms:**
- Agent created but instructions field is blank
- Subagent instructions missing

**Diagnosis:**
1. Open Studio page
2. Press `F12` → Console
3. Look for `[ROVO PATCH]` logs

**Common causes:**
- Page-world script not loaded: Check `window.__rovoPageWorldInstalled` (should = `9`)
- ProseMirror serialization failed: Check console errors
- GraphQL mutation not intercepted: Check Network tab for mutation request

**Fix:**
1. Reload extension in `chrome://extensions`
2. Refresh Studio page
3. Try provisioning again

### Problem: Triggers (invocationDescription) missing

**Symptoms:**
- Subagents created but "When to use" field is empty

**Diagnosis:**
```javascript
// In browser console:
window.__rovoCapture
// Check scenarios[].invocationDescription field
```

**Common causes:**
- Trigger textarea not filled before mutation
- Selector changed (Studio UI update)

**Fix:**
1. Check HOW-IT-WORKS.md → Key Selectors Reference
2. Update selectors in `provisioner.ts` if Studio UI changed
3. Rebuild extension

### Problem: Name/Description wrong

**Symptoms:**
- Agent created with "Untitled" or wrong name/description

**Diagnosis:**
1. Check console logs during provisioning
2. Verify InlineEdit fields filled before Activate clicked

**Common causes:**
- InlineEdit click handlers didn't trigger
- Mutation fired before fields populated
- Race condition between fill and activate

**Fix:**
1. Add delays between fill and activate steps
2. Check `waitForElement` timeout in `provisioner.ts`

### Problem: 500 Internal Server Error

**Symptoms:**
- Agent creation fails with 500 error

**Common causes:**
- Required field missing (e.g., name = "Untitled")
- Invalid GraphQL mutation payload

**Diagnosis:**
1. Open DevTools → Network tab
2. Find `createAgentMutation` request
3. Check request payload for missing/invalid fields

**Fix:**
1. Verify all required fields populated before mutation
2. Check mutation payload structure matches Atlassian API spec

### Problem: Extension not loading in browser

**Symptoms:**
- Extension card shows errors
- Extension icon not appearing

**Common causes:**
- `dist/` directory missing (forgot to build)
- `manifest.json` syntax error
- Permissions issue (Windows symlinks)

**Fix:**
1. Run `npm run build`
2. Validate `manifest.json` syntax
3. Check browser console for specific error messages

---

## Technical Reference

### DOM Selectors

Selectors used to fill Studio UI fields. **Update if Studio UI changes.**

**Main Agent Fields:**

| Field | Selector | Type |
|-------|----------|------|
| Name (read-view) | `[data-testid="agent-heading-toolbar-name-field-read-view"]` | InlineEdit heading |
| Name (edit input) | `input[name="inlineEdit"]` | Input |
| Description (read-view) | `[data-testid="agent-heading-toolbar-description-field-read-view"]` | InlineEdit heading |
| Description (edit input) | `input[name="inlineEdit"]` | Input |
| Instructions editor | `[data-testid="core-instructions-editor"] [contenteditable="true"]` | ProseMirror |
| Activate button | `[data-testid="activate-agent-create-button"]` | Button |

**Subagent Fields:**

| Field | Selector | Type |
|-------|----------|------|
| Add subagent button | `button` with text "Add subagent" or "Add new scenario" | Button |
| Scenario name input | `input[aria-label="Scenario name"]` | Input |
| Trigger textarea | First `<textarea>` after name input | Textarea |
| Instructions editor | First `[contenteditable="true"]` after name input | ProseMirror |
| Enable toggle | `[role="switch"]` walked up from name input | Toggle |

### GraphQL Mutation Payload

Fields patched into `createAgentMutation`:

```typescript
{
  input: {
    name: string,              // From name heading textContent
    description: string,        // From description heading textContent
    instructions: string,       // From main ProseMirror doc (markdown)
  },
  scenarios: [
    {
      name: string,                     // From scenario name input value
      invocationDescription: string,    // From trigger textarea value
      instructions: string,              // From subagent ProseMirror doc (markdown)
      isActive: true,                   // Hardcoded true (auto-enable)
    }
  ]
}
```

### File Locations

**Local development:**
- Source: `chrome-extension/src/`
- Build output: `chrome-extension/dist/`
- Private key: `chrome-extension/agentman.pem` (gitignored)

**User installation:**
- Extension: `~/.agentman/chrome-extension/agentman.crx`
- Registration JSON: `~/Library/Application Support/Google/Chrome/External Extensions/` (macOS)
- Registration JSON: `~/.config/google-chrome/External Extensions/` (Linux)
- Windows registry: `HKEY_LOCAL_MACHINE\SOFTWARE\Google\Chrome\Extensions\jfplibfgoojmkffdcglchjdkpliiljbh`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTMAN_CHROME_EXTENSION` | off | Exposes Chrome Extension provisioning path in CLI menu |

### API Endpoints

**CLI Server:**
- Health: `GET http://127.0.0.1:19876/health`
- List agents: `GET http://127.0.0.1:19876/agents` (requires `Bearer <token>`)
- Get agent: `GET http://127.0.0.1:19876/agents/<name>` (requires `Bearer <token>`)

**Atlassian API:**
- GraphQL endpoint: `https://studio.atlassian.com/gateway/api/graphql/`
- Mutation: `createAgentMutation`

### Version Management

**Current version:** Check `manifest.json` → `"version"` field

**Bumping version:**
1. Edit `manifest.json` → `"version": "X.Y.Z"`
2. Run `npm run build`
3. Test locally
4. Run `npm run build:crx` (optional)
5. Commit: `git commit -m "chore(extension): bump version to X.Y.Z"`

**Versioning scheme:**
- **Patch** (0.1.1 → 0.1.2): Bug fixes
- **Minor** (0.1.2 → 0.2.0): New features
- **Major** (0.2.0 → 1.0.0): Breaking changes

---

## Additional Resources

- [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) - Complete end-to-end workflows and architecture
- [README.md](./README.md) - Quick start and production usage
- [chrome-extension-install.md](../docs/chrome-extension-install.md) - Programmatic installation
- [bundle-format.md](../docs/bundle-format.md) - Agent bundle specification
- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/develop/migrate)

---

## Contributing

When making changes to the extension:

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and test:**
   ```bash
   npm run build
   # Load unpacked in browser and test
   ```

3. **Run type checking:**
   ```bash
   npm run typecheck
   ```

4. **Commit following conventions:**
   ```bash
   git commit -m "feat(extension): add new feature"
   git commit -m "fix(extension): fix bug"
   git commit -m "chore(extension): update dependencies"
   ```

5. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for full contribution guidelines.

---

**Questions or issues?**
- Check [HOW-IT-WORKS.md](./HOW-IT-WORKS.md) for detailed workflows
- Search existing issues: [GitHub Issues](https://github.com/your-org/agent-manager/issues)
- Create a new issue with reproduction steps
