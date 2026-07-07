# How It Works

Complete guide: install extension → create agent → provision to Rovo Studio.

Before running the CLI with Chrome Extension flows, enable the feature flag:

**macOS/Linux:**
```bash
AGENTMAN_CHROME_EXTENSION=1 npx --yes @ai-agent-manager/cli@latest https://your-bundle-server-url
```

**Windows PowerShell:**
```powershell
$env:AGENTMAN_CHROME_EXTENSION="1"; npx --yes @ai-agent-manager/cli@latest https://your-bundle-server-url
```

---

## End-to-End Guide

### 1. Install Chrome Extension

**Option A: Load Unpacked (Development)**

1. **Build extension**:
   ```bash
   cd chrome-extension
   npm install
   npm run build
   ```

2. **Load in browser**:
   - Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
   - Enable **Developer mode** (toggle top-right)
   - Click **Load unpacked**
   - Select `chrome-extension/dist/` folder
   - Extension icon (🤖) appears in toolbar

**Option B: Via Agent Manager CLI (Production)**

1. **Run agent manager**:
   ```bash
   npx --yes @ai-agent-manager/cli@latest https://bootstrap.example.com
   ```

2. **Select**: Install Chrome Extension from menu

3. **Restart browser** and approve installation prompt

**Option C: Install .crx File**

1. **Get .crx file**:
   ```bash
   cd chrome-extension
   npm run build:crx
   # Produces dist/agentman.crx
   ```

2. **Install**:
   - Drag `agentman.crx` to `chrome://extensions`
   - Approve installation

### 2. Create/Publish New Rovo Agent

**Step 1: Create Agent YAML**

If your team uses a bundle server, add the new agent directory to that bundle source and publish a new bundle version.

For local testing only, create a local bundle root and place your agent as a subdirectory:

Create agent directory in bundles:
```bash
mkdir -p ~/my-local-bundle/my-agent
cd ~/my-local-bundle/my-agent
```

Create `rovo-agent.yaml`:
```yaml
apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent

name: My Agent Name
description: Brief description of what agent does

instructions: |
  ### Your Role & Goal
  
  Describe what the agent does and who it helps.
  
  ### Workflow
  
  1. First step - what happens
  2. Second step - next action
  3. Final step - outcome

# Skills agent can use (optional)
skills:
  - Search with JQL
  - Create Jira issues with advanced configuration

# Knowledge settings (optional)
knowledge: all  # or 'custom' or 'none'
webSearch: false
deepResearch: false

# Subagents (optional)
subagents:
  handle-updates:
    name: Handle Updates
    enabled: true
    trigger: update existing items, modify records, change status
    instructions: |
      ### Your Role
      
      Handle updates to existing records.
      
      ### Steps
      
      1. Identify what to update
      2. Verify permissions
      3. Make changes
    skills:
      - Update work item
```

**Step 2: Verify Agent**

Check syntax and availability:
```bash
npx --yes @ai-agent-manager/cli@latest https://bootstrap.example.com
# Should see your agent in list
```

### 3. Provision Agent to Rovo Studio

**Step 1: Start Agent Manager Server**

```bash
npx --yes @ai-agent-manager/cli@latest https://bootstrap.example.com
```

Select: **Provision Rovo Agents → Chrome Extension**

Server displays:
```
Server running on http://127.0.0.1:19876
Auth token: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**Step 2: Connect Extension**

1. Click extension icon (🤖) in browser toolbar
2. Paste auth token from terminal
3. Click **Connect**
4. Extension shows available agents from bundles

**Step 3: Provision to Studio**

1. **Open Atlassian Studio**: Navigate to https://studio.atlassian.com
2. **Go to agents page** in your workspace
3. **Click extension icon (🤖)**, find your agent in list
4. **Click "Provision"** button next to agent name

Extension will:
- Fill agent name & description
- Add main instructions (markdown preserved)
- Create subagents with names, triggers, instructions
- Auto-enable subagents
- Click Activate automatically

Progress bar shows each step. Success message when complete.

**Step 4: Verify Agent Created**

1. Check Studio agents list - your agent should appear
2. Open agent - verify:
   - ✅ Name correct
   - ✅ Description correct
   - ✅ Instructions formatted (markdown preserved)
   - ✅ Subagents present with names
   - ✅ Subagents have triggers (invocationDescription)
   - ✅ Subagents enabled (active)
   - ✅ Skills attached

### Quick Reference

| Task | Command/Action |
|------|----------------|
| Start agent manager | `npx --yes @ai-agent-manager/cli@latest https://bootstrap.example.com` |
| Build extension | `cd chrome-extension && npm run build` |
| Reload extension | `chrome://extensions` → click 🔄 on extension |
| Connect extension | Click 🤖 → paste token → Connect |
| Provision agent | Open Studio → click 🤖 → Provision |
| Debug | `F12` on Studio tab → check `[ROVO PATCH]` logs |
| Check mutation | Console: `window.__rovoCapture` |

---

## Architecture Overview

Extension provisions Rovo agents in Atlassian Studio by:

1. **UI Automation** — Fills form fields (name, description, instructions, subagents)
2. **Network Interception** — Patches GraphQL `createAgentMutation` before sending
3. **ProseMirror Integration** — Serializes markdown from ProseMirror editors
4. **Auto-activation** — Clicks Activate button automatically

### Key Components

```
src/
├── popup/           # Extension UI (connect to server, agent list)
├── content/         # Content script (runs provisioning on Studio pages)
├── page-world/      # Main-world script (DOM access, mutation patching)
└── lib/
    ├── provisioner.ts   # UI automation logic
    └── types.ts         # Agent config types
```

### How Provisioning Works

```
1. User clicks "Provision" in popup
   ↓
2. Content script fills UI fields
   - Name/Description via InlineEdit
   - Instructions via ProseMirror
   - Subagents (name, trigger, instructions)
   ↓
3. User clicks Activate (or auto-clicked)
   ↓
4. Page-world script intercepts GraphQL mutation
   - Reads values from DOM
   - Patches into mutation payload:
     * input.name
     * input.description
     * input.instructions (markdown preserved)
     * scenarios[].name
     * scenarios[].invocationDescription (triggers)
     * scenarios[].instructions (markdown preserved)
     * scenarios[].isActive = true
   ↓
5. Mutation sent to server → Agent created ✓
```

## Adding a New Agent

### Option 1: With Agent Manager CLI

**Easiest method** — uses existing agent manager infrastructure.

1. **Create agent directory** in your bundles folder:
   ```bash
   mkdir -p ~/.agentman/bundles/my-new-agent
   cd ~/.agentman/bundles/my-new-agent
   ```

2. **Create `rovo-agent.yaml`**:
   ```yaml
   apiVersion: rovo.atlassian.com/v2-beta
   kind: StudioAgent
   name: My New Agent
   description: What this agent does
   instructions: |
     ### Your Role
     
     Describe what the agent does here.
     
     ### Workflow
     
     1. Step one
     2. Step two
   
   # Optional: Add subagents
   subagents:
     subagent-key:
       name: Subagent Name
       enabled: true
       trigger: when to activate this subagent
       instructions: |
         What this subagent does.
   ```

3. **Run agent manager**:
   ```bash
   AGENTMAN_CHROME_EXTENSION=1 npx --yes @ai-agent-manager/cli@latest https://your-bundle-server-url
   ```
   
   Select **Provision Rovo Agents → Chrome Extension**

4. **Provision** — Click "Provision" next to your new agent

### Option 2: Without Agent Manager CLI

**Manual method** — directly edit extension or create config.

1. **Create config JSON** matching `RovoAgentConfig` type (see `types.ts`)

2. **Add to extension** — Modify popup to load your config:
   ```typescript
   // In popup.ts
   const myAgent: AgentDetail = {
     dirName: 'my-agent',
     config: {
       apiVersion: 'rovo.atlassian.com/v2-beta',
       kind: 'StudioAgent',
       identity: {
         name: 'My Agent',
         description: 'What it does',
       },
       scenarios: {
         default: {
           instructions: 'Main instructions here',
         },
         custom: [
           {
             name: 'Subagent Name',
             trigger: 'activation trigger',
             instructions: 'Subagent instructions',
             enabled: true,
           }
         ]
       }
     },
     meta: null,
   };
   ```

3. **Rebuild extension**:
   ```bash
   npm run build
   ```

4. **Reload** in `chrome://extensions`

### Option 3: With Claude

Ask Claude to:
1. Generate `rovo-agent.yaml` for your use case
2. Create instructions following best practices
3. Define subagents with clear triggers
4. Add to agent manager bundles
5. Provision via extension

**Example prompt:**
> "Create a Rovo agent YAML for [use case]. Include main instructions and 2 subagents for [scenarios]. Follow Atlassian Rovo best practices."

For a quick explanation of repository sample assets, see root [README Examples Folder section](../README.md#examples-folder).

## Running the Extension

### Development

```bash
cd chrome-extension
npm install
npm run build
```

Load unpacked in `chrome://extensions` → point to `dist/` folder.

After code changes:
```bash
npm run build
```
Click reload (🔄) in `chrome://extensions`.

### Production

```bash
npm run build:crx
```

Produces `dist/agentman.crx` for distribution.

Or use Agent Manager CLI:
```bash
AGENTMAN_CHROME_EXTENSION=1 npx --yes @ai-agent-manager/cli@latest https://your-bundle-server-url
# Select: Install Chrome Extension
```

## Key Selectors Reference

DOM selectors used to populate fields. Update if Studio UI changes.

### Main Agent Fields

| Field | Selector | Type |
|-------|----------|------|
| Name (read-view) | `[data-testid="agent-heading-toolbar-name-field-read-view"]` | InlineEdit heading |
| Name (edit input) | `input[name="inlineEdit"]` (within form) | Input |
| Description (read-view) | `[data-testid="agent-heading-toolbar-description-field-read-view"]` | InlineEdit heading |
| Description (edit input) | `input[name="inlineEdit"]` (within form) | Input |
| Instructions | `[data-testid="core-instructions-editor"] [contenteditable="true"]` | ProseMirror editor |
| Activate button | `[data-testid="activate-agent-create-button"]` | Button |

### Subagent Fields

| Field | Selector | Type |
|-------|----------|------|
| Add subagent button | `button` with text "Add subagent" or "Add new scenario" | Button |
| Scenario name input | `input[aria-label="Scenario name"]` | Input |
| Trigger textarea | First `<textarea>` after name input in DOM order | Textarea |
| Instructions editor | First `[contenteditable="true"]` after name input (not in core-instructions-editor) | ProseMirror editor |
| Enable toggle | `[role="switch"]` walked up from name input | Toggle switch |

### GraphQL Mutation Fields

Fields patched into `createAgentMutation`:

| Mutation Path | Source | Notes |
|---------------|--------|-------|
| `input.name` | Name heading `textContent` | Patched from DOM |
| `input.description` | Description heading `textContent` | Patched from DOM |
| `input.instructions` | Main instructions ProseMirror doc | Serialized to markdown |
| `scenarios[].name` | Scenario name input `value` | Patched from DOM |
| `scenarios[].invocationDescription` | Trigger textarea `value` | Patched from DOM (this is "trigger") |
| `scenarios[].instructions` | Subagent instructions ProseMirror doc | Serialized to markdown |
| `scenarios[].isActive` | Hardcoded `true` | Auto-enables subagents |

### Network Interception

| What | Where |
|------|-------|
| Intercept point | `fetch()` wrapper in page-world script |
| Mutation URL pattern | `/gateway/api/graphql/` + `operation=createAgentMutation` |
| Capture storage | `window.__rovoCapture` (array, max 30 entries) |
| Page-world version | `window.__rovoPageWorldInstalled` (must = `9`) |

## Version Management

### Bumping Extension Version

**When to bump**:
- Bug fixes: Patch version (0.1.1 → 0.1.2)
- New features: Minor version (0.1.2 → 0.2.0)
- Breaking changes: Major version (0.2.0 → 1.0.0)

**Process**:

1. **Update version** in `manifest.json`:
   ```json
   {
     "version": "0.1.2",
     ...
   }
   ```

2. **Rebuild extension**:
   ```bash
   npm run build
   ```

3. **Test locally**:
   - Load unpacked in `chrome://extensions`
   - Verify version shows in extension details
   - Test provisioning flow

4. **Build production .crx** (optional):
   ```bash
   npm run build:crx
   ```
   Produces `dist/agentman.crx` with new version

5. **Commit changes**:
   ```bash
   git add chrome-extension/manifest.json
   git commit -m "chore(extension): bump version to 0.1.2"
   ```

**Version format**: `major.minor.patch` (follows [Semantic Versioning](https://semver.org/))

**Current version**: Check `manifest.json` → `"version"` field

## Troubleshooting

**Problem: Instructions empty after save**
- Check console for `[ROVO PATCH]` logs
- Verify page-world script loaded: `window.__rovoPageWorldInstalled` should = `9`

**Problem: Triggers missing**
- Check mutation capture: `window.__rovoCapture`
- Verify `invocationDescription` field in scenarios

**Problem: Name/Description wrong**
- Verify InlineEdit fills completed before Activate
- Check DOM heading values before mutation fires

**Problem: 500 Internal Server Error**
- Usually means name = "Untitled" or required field missing
- Check mutation body in Network tab for all required fields